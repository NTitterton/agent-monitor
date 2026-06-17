import Cocoa
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
  private var window: NSWindow!
  private var webView: WKWebView!
  private var serverProcess: Process?
  private var serverOutput = ""
  private let port = 5173

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
    if isServerRunning() { return }

    let process = Process()
    process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    process.arguments = ["node", "server/index.js"]
    process.currentDirectoryURL = projectRoot()
    process.environment = [
      "PATH": "/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin",
      "PORT": String(port)
    ]
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
    if isServerRunning() {
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

  private func isServerRunning() -> Bool {
    guard let url = URL(string: "http://127.0.0.1:\(port)/api/providers") else { return false }
    var request = URLRequest(url: url)
    request.timeoutInterval = 0.2

    let semaphore = DispatchSemaphore(value: 0)
    var ok = false

    URLSession.shared.dataTask(with: request) { _, response, _ in
      if let httpResponse = response as? HTTPURLResponse {
        ok = (200..<300).contains(httpResponse.statusCode)
      }
      semaphore.signal()
    }.resume()

    _ = semaphore.wait(timeout: .now() + 0.3)
    return ok
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

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.activate(ignoringOtherApps: true)
app.run()
