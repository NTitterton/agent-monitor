import Cocoa
import Darwin
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var serverProcess: Process?
  private var serverOutput = ""
  private var port = 5173
  private let candidatePorts = desktopCandidatePorts()

  func applicationDidFinishLaunching(_ notification: Notification) {
    startServerIfNeeded()
    createWindow()
    loadAppWhenReady(attemptsRemaining: 80)
  }

  func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
    true
  }

  func applicationWillTerminate(_ notification: Notification) {
    serverProcess?.terminate()
  }

  private func createWindow() {
    let configuration = WKWebViewConfiguration()
    configuration.defaultWebpagePreferences.allowsContentJavaScript = true

    webView = WKWebView(frame: .zero, configuration: configuration)
    webView.navigationDelegate = self

    window = NSWindow(
      contentRect: NSRect(x: 0, y: 0, width: 1320, height: 860),
      styleMask: [.titled, .closable, .miniaturizable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.center()
    window.title = "Agent Monitor"
    window.contentView = webView
    window.makeKeyAndOrderFront(nil)
  }

  private func startServerIfNeeded() {
    if let runningPort = candidatePorts.first(where: { isAgentMonitorRunning(on: $0) }) {
      port = runningPort
      return
    }

    guard let availablePort = candidatePorts.first(where: { !isPortOpen($0) }) else {
      showStartupError("Agent Monitor could not find an available local port in 5173-5183.\n\n\(startupDiagnostics())")
      return
    }

    port = availablePort

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", "server/index.js"]
    process.currentDirectoryURL = projectRoot()
    process.environment = serverEnvironment(port: port)
    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    captureServerOutput(stdout)
    captureServerOutput(stderr)

    do {
      try process.run()
      serverProcess = process
    } catch {
      showStartupError("Could not start the Agent Monitor local server: \(error.localizedDescription)")
    }
  }

  private func loadAppWhenReady(attemptsRemaining: Int) {
    if isAgentMonitorRunning(on: port) {
      webView.load(URLRequest(url: appURL()))
      return
    }

    if attemptsRemaining <= 0 {
      showStartupError(
        "Agent Monitor could not connect to its local server at \(appURL().absoluteString).\n\n\(startupDiagnostics())"
      )
      return
    }

    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
      self.loadAppWhenReady(attemptsRemaining: attemptsRemaining - 1)
    }
  }

  private func isAgentMonitorRunning(on port: Int) -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = 0.2

    let semaphore = DispatchSemaphore(value: 0)
    var ok = false

    URLSession.shared.dataTask(with: request) { data, response, _ in
      if let httpResponse = response as? HTTPURLResponse {
        let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
        ok = (200..<300).contains(httpResponse.statusCode) && body.contains("Agent Monitor")
      }
      semaphore.signal()
    }.resume()

    _ = semaphore.wait(timeout: .now() + 0.3)
    return ok
  }

  private func isPortOpen(_ port: Int) -> Bool {
    let socketDescriptor = socket(AF_INET, SOCK_STREAM, 0)
    if socketDescriptor < 0 { return true }
    defer { close(socketDescriptor) }

    var address = sockaddr_in()
    address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
    address.sin_family = sa_family_t(AF_INET)
    address.sin_port = UInt16(port).bigEndian
    address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

    let result = withUnsafePointer(to: &address) {
      $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
        connect(socketDescriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
      }
    }
    return result == 0
  }

  private func projectRoot() -> URL {
    Bundle.main.bundleURL
      .deletingLastPathComponent()
      .deletingLastPathComponent()
  }

  private func appURL() -> URL {
    URL(string: "http://127.0.0.1:\(port)/")!
  }

  private func captureServerOutput(_ pipe: Pipe) {
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
      DispatchQueue.main.async {
        self?.appendServerOutput(text)
      }
    }
  }

  private func appendServerOutput(_ text: String) {
    serverOutput += text
    if serverOutput.count > 4000 {
      serverOutput = String(serverOutput.suffix(4000))
    }
  }

  private func startupDiagnostics() -> String {
    let output = serverOutput.trimmingCharacters(in: .whitespacesAndNewlines)
    let root = projectRoot().path
    if output.isEmpty {
      return "Project root: \(root)\nNo server output was captured. Confirm Node is installed and available on PATH."
    }
    return "Project root: \(root)\nServer output:\n\(output)"
  }

  private func showStartupError(_ message: String) {
    let alert = NSAlert()
    alert.messageText = "Agent Monitor"
    alert.informativeText = message
    alert.alertStyle = .critical
    alert.runModal()
  }
}

final class DesktopSelfTest {
  private var serverProcess: Process?
  private var serverOutput = ""
  private let candidatePorts = desktopCandidatePorts()

  func run() -> Int32 {
    if let runningPort = candidatePorts.first(where: { isAgentMonitorRunning(on: $0) }) {
      print("Agent Monitor desktop self-test reused http://127.0.0.1:\(runningPort)/")
      return 0
    }

    guard let port = candidatePorts.first(where: { !isPortOpen($0) }) else {
      fputs("Agent Monitor desktop self-test could not find an available local port.\n", stderr)
      return 1
    }

    do {
      try startServer(on: port)
      if waitForHealth(on: port) {
        print("Agent Monitor desktop self-test started http://127.0.0.1:\(port)/")
        serverProcess?.terminate()
        return 0
      }
      fputs("Agent Monitor desktop self-test could not reach /api/health.\n\(startupDiagnostics())\n", stderr)
    } catch {
      fputs("Agent Monitor desktop self-test could not start server: \(error.localizedDescription)\n", stderr)
    }

    serverProcess?.terminate()
    return 1
  }

  private func startServer(on port: Int) throws {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", "server/index.js"]
    process.currentDirectoryURL = projectRoot()
    process.environment = serverEnvironment(port: port)
    let stdout = Pipe()
    let stderr = Pipe()
    process.standardOutput = stdout
    process.standardError = stderr
    captureServerOutput(stdout)
    captureServerOutput(stderr)
    try process.run()
    serverProcess = process
  }

  private func waitForHealth(on port: Int) -> Bool {
    for _ in 0..<80 {
      if isAgentMonitorRunning(on: port) { return true }
      Thread.sleep(forTimeInterval: 0.1)
    }
    return false
  }

  private func captureServerOutput(_ pipe: Pipe) {
    pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
      let data = handle.availableData
      guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
      self?.serverOutput += text
      if let count = self?.serverOutput.count, count > 4000 {
        self?.serverOutput = String(self?.serverOutput.suffix(4000) ?? "")
      }
    }
  }

  private func startupDiagnostics() -> String {
    let output = serverOutput.trimmingCharacters(in: .whitespacesAndNewlines)
    let root = projectRoot().path
    if output.isEmpty {
      return "Project root: \(root)\nNo server output was captured. Confirm Node is installed and available on PATH."
    }
    return "Project root: \(root)\nServer output:\n\(output)"
  }
}

func desktopCandidatePorts() -> [Int] {
  let value = ProcessInfo.processInfo.environment["AGENT_MONITOR_DESKTOP_PORT_RANGE"] ?? "5173-5183"
  let parts = value.split(separator: "-", maxSplits: 1).compactMap { Int($0.trimmingCharacters(in: .whitespaces)) }
  if parts.count == 2, parts[0] > 0, parts[0] <= parts[1] {
    return Array(parts[0]...parts[1])
  }
  return Array(5173...5183)
}

func serverEnvironment(port: Int) -> [String: String] {
  var environment = ProcessInfo.processInfo.environment
  environment["PATH"] = "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"
  environment["PORT"] = String(port)
  return environment
}

func projectRoot() -> URL {
  Bundle.main.bundleURL
    .deletingLastPathComponent()
    .deletingLastPathComponent()
}

func isAgentMonitorRunning(on port: Int) -> Bool {
  guard let url = URL(string: "http://127.0.0.1:\(port)/api/health") else { return false }
  var request = URLRequest(url: url)
  request.timeoutInterval = 0.2

  let semaphore = DispatchSemaphore(value: 0)
  var ok = false

  URLSession.shared.dataTask(with: request) { data, response, _ in
    if let httpResponse = response as? HTTPURLResponse {
      let body = data.flatMap { String(data: $0, encoding: .utf8) } ?? ""
      ok = (200..<300).contains(httpResponse.statusCode) && body.contains("Agent Monitor")
    }
    semaphore.signal()
  }.resume()

  _ = semaphore.wait(timeout: .now() + 0.3)
  return ok
}

func isPortOpen(_ port: Int) -> Bool {
  let socketDescriptor = socket(AF_INET, SOCK_STREAM, 0)
  if socketDescriptor < 0 { return true }
  defer { close(socketDescriptor) }

  var address = sockaddr_in()
  address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
  address.sin_family = sa_family_t(AF_INET)
  address.sin_port = UInt16(port).bigEndian
  address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

  let result = withUnsafePointer(to: &address) {
    $0.withMemoryRebound(to: sockaddr.self, capacity: 1) {
      connect(socketDescriptor, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
    }
  }
  return result == 0
}

if ProcessInfo.processInfo.environment["AGENT_MONITOR_DESKTOP_SELF_TEST"] == "1" {
  let selfTest = DesktopSelfTest()
  exit(selfTest.run())
}

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
