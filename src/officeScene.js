import * as THREE from "./vendor/three.module.js";

const palette = {
  floor: 0xd8d0c1,
  tile: 0xc8c0b2,
  wall: 0xb9ae9f,
  wallTop: 0xede8de,
  desk: 0x9a6744,
  deskTop: 0xc58c5c,
  chair: 0x46556a,
  screen: 0x263143,
  paper: 0xf5f0df,
  plant: 0x3f8f58,
  rug: 0x6a89a8,
  selected: 0x2b5f94,
  running: 0x2f8f51,
  waiting: 0xc47a13,
  idle: 0x667085,
  done: 0x4f6f9d
};

export function renderThreeOfficeView(canvas, agents, selectedAgentId, focusAgentId = null) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 2));
  renderer.setSize(canvas.width, canvas.height, false);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8a7966);
  addLights(scene);

  const pickables = [];
  const animated = [];
  const focusedAgent = focusAgentId ? agents.find((agent) => agent.id === focusAgentId) : null;
  if (focusedAgent) {
    buildFocusedOffice(scene, focusedAgent, animated);
  } else {
    buildOfficeFloor(scene, agents, selectedAgentId, pickables, animated);
  }

  const camera = createCamera(canvas, Boolean(focusedAgent), agents.length);
  let disposed = false;
  let animationFrame = 0;
  renderer.render(scene, camera);
  const animate = (time) => {
    if (disposed || !canvas.isConnected) return;
    const seconds = time / 1000;
    animated.forEach((item, index) => {
      item.rotation.y += item.userData.spin || 0;
      item.position.y = item.userData.baseY + Math.sin(seconds * 1.7 + index) * (item.userData.bob || 0);
    });
    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  };
  animationFrame = requestAnimationFrame(animate);

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  return {
    pick(event) {
      if (focusedAgent || !pickables.length) return null;
      const rect = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      pointer.y = -(((event.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1);
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(pickables, true)[0];
      return hit?.object?.userData?.agent || hit?.object?.parent?.userData?.agent || null;
    },
    destroy() {
      disposed = true;
      if (animationFrame) cancelAnimationFrame(animationFrame);
      scene.traverse((item) => {
        item.geometry?.dispose?.();
        if (Array.isArray(item.material)) {
          item.material.forEach((entry) => entry.dispose?.());
        } else {
          item.material?.dispose?.();
        }
      });
      renderer.dispose();
    }
  };
}

function createCamera(canvas, focused, count) {
  const aspect = canvas.width / Math.max(canvas.height, 1);
  const span = focused ? 10 : Math.max(12, Math.ceil(Math.sqrt(Math.max(count, 1))) * 4.2);
  const camera = new THREE.OrthographicCamera(
    (-span * aspect) / 2,
    (span * aspect) / 2,
    span / 2,
    -span / 2,
    0.1,
    100
  );
  camera.position.set(focused ? 7.8 : 9, focused ? 8.6 : 10.5, focused ? 8.4 : 10);
  camera.lookAt(0, 0, 0);
  return camera;
}

function addLights(scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x6d6155, 2.4));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(6, 10, 5);
  sun.castShadow = true;
  sun.shadow.mapSize.width = 1024;
  sun.shadow.mapSize.height = 1024;
  sun.shadow.camera.left = -18;
  sun.shadow.camera.right = 18;
  sun.shadow.camera.top = 18;
  sun.shadow.camera.bottom = -18;
  scene.add(sun);
}

function buildOfficeFloor(scene, agents, selectedAgentId, pickables, animated) {
  const count = Math.max(agents.length, 1);
  const columns = Math.max(1, Math.ceil(Math.sqrt(count * 1.55)));
  const rows = Math.max(1, Math.ceil(count / columns));
  const cell = 3.2;
  const width = columns * cell + 1.6;
  const depth = rows * cell + 1.8;

  const floor = mesh(new THREE.BoxGeometry(width, 0.12, depth), palette.floor);
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);
  addFloorTiles(scene, width, depth);

  agents.forEach((agent, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    const x = (column - (columns - 1) / 2) * cell;
    const z = (row - (rows - 1) / 2) * cell;
    const group = buildCubicle(agent, agent.id === selectedAgentId, false, animated);
    group.position.set(x, 0, z);
    group.userData.agent = agent;
    scene.add(group);
    group.traverse((item) => {
      if (item.isMesh) {
        item.userData.agent = agent;
        pickables.push(item);
      }
    });
  });

  addCommonAreas(scene, width, depth);
}

function addFloorTiles(scene, width, depth) {
  const grid = new THREE.GridHelper(Math.max(width, depth), Math.ceil(Math.max(width, depth)), palette.tile, palette.tile);
  grid.position.y = 0.005;
  scene.add(grid);
}

function addCommonAreas(scene, width, depth) {
  const lounge = mesh(new THREE.BoxGeometry(2.6, 0.05, 1.4), 0x55728b);
  lounge.position.set(-width / 2 + 2.3, 0.02, -depth / 2 + 1.2);
  scene.add(lounge);
  addPlant(scene, -width / 2 + 1.1, -depth / 2 + 2.1, 0.9);
  addPlant(scene, width / 2 - 1.4, depth / 2 - 1.2, 0.8);
  addCoffeeTable(scene, width / 2 - 2.2, -depth / 2 + 1.1);
}

function buildFocusedOffice(scene, agent, animated) {
  const floor = mesh(new THREE.BoxGeometry(9.5, 0.12, 6.6), statusFloor(agent));
  floor.position.y = -0.08;
  floor.receiveShadow = true;
  scene.add(floor);

  const cubicle = buildCubicle(agent, true, true, animated);
  cubicle.scale.set(1.55, 1.55, 1.55);
  cubicle.position.set(-1.25, 0, 0.4);
  scene.add(cubicle);

  addContextBoard(scene, agent, 2.95, -1.95);
  addSignalBoard(scene, agent, 3.05, 1.3, animated);
  addPlant(scene, -3.85, 2.35, 1.05);
  addPlant(scene, 3.95, -2.6, 0.85);
}

function buildCubicle(agent, selected, focused, animated) {
  const group = new THREE.Group();
  const floor = mesh(new THREE.BoxGeometry(2.45, 0.08, 2.25), statusFloor(agent));
  floor.position.y = 0;
  floor.receiveShadow = true;
  group.add(floor);

  const wallMaterial = material(selected ? palette.selected : palette.wall);
  addBox(group, [0.12, 0.95, 2.28], [-1.22, 0.48, 0], wallMaterial);
  addBox(group, [2.48, 0.95, 0.12], [0, 0.48, -1.12], wallMaterial);
  addBox(group, [0.12, 0.7, 1.28], [1.22, 0.35, -0.5], wallMaterial);
  addBox(group, [2.58, 0.12, 0.16], [0, 0.98, -1.12], material(palette.wallTop));

  addDesk(group, focused);
  addAgentAvatar(group, agent, focused, animated);
  addLowPolyMonitor(group, agent);
  addDeskClutter(group, focused);
  addStatusBeacon(group, agent, selected, animated);
  return group;
}

function addDesk(group, focused) {
  addBox(group, [1.55, 0.22, 0.58], [0.05, 0.28, 0.55], material(palette.deskTop));
  addBox(group, [1.5, 0.18, 0.1], [0.05, 0.14, 0.84], material(palette.desk));
  addBox(group, [0.12, 0.42, 0.52], [-0.62, 0.04, 0.56], material(palette.desk));
  addBox(group, [0.12, 0.42, 0.52], [0.72, 0.04, 0.56], material(palette.desk));
  if (focused) {
    addBox(group, [0.45, 0.05, 0.34], [-0.45, 0.43, 0.32], material(palette.paper));
    addBox(group, [0.36, 0.04, 0.22], [0.42, 0.43, 0.35], material(0x6d7f99));
  }
}

function addAgentAvatar(group, agent, focused, animated) {
  const accent = statusAccent(agent);
  const body = mesh(new THREE.CapsuleGeometry(0.18, focused ? 0.42 : 0.3, 4, 8), palette.chair);
  body.position.set(-0.08, 0.58, 1.02);
  body.rotation.x = -0.18;
  body.castShadow = true;
  group.add(body);

  const head = mesh(new THREE.IcosahedronGeometry(focused ? 0.22 : 0.17, 1), accent);
  head.position.set(-0.08, focused ? 1.0 : 0.86, 0.92);
  head.castShadow = true;
  head.userData.baseY = head.position.y;
  head.userData.bob = focused ? 0.035 : 0.02;
  head.userData.spin = 0.004;
  animated.push(head);
  group.add(head);

  const chair = mesh(new THREE.BoxGeometry(0.54, 0.2, 0.54), palette.chair);
  chair.position.set(-0.08, 0.25, 1.12);
  chair.castShadow = true;
  group.add(chair);
}

function addLowPolyMonitor(group, agent) {
  const screen = mesh(new THREE.BoxGeometry(0.62, 0.42, 0.07), palette.screen);
  screen.position.set(0.38, 0.72, 0.26);
  screen.rotation.x = -0.18;
  screen.castShadow = true;
  group.add(screen);

  const glow = mesh(new THREE.BoxGeometry(0.5, 0.29, 0.025), statusAccent(agent));
  glow.position.set(0.38, 0.72, 0.215);
  glow.rotation.x = -0.18;
  group.add(glow);
}

function addDeskClutter(group, focused) {
  addBox(group, [0.28, 0.025, 0.2], [-0.48, 0.42, 0.52], material(palette.paper));
  addBox(group, [0.18, 0.05, 0.15], [0.86, 0.42, 0.5], material(0x38475b));
  if (focused) {
    addBox(group, [0.12, 0.16, 0.12], [0.95, 0.51, 0.72], material(0xe5d6a8));
    addBox(group, [0.32, 0.025, 0.19], [-0.1, 0.43, 0.27], material(0xfff1c7));
  }
}

function addStatusBeacon(group, agent, selected, animated) {
  const beacon = mesh(new THREE.CylinderGeometry(0.14, 0.14, 0.06, 12), selected ? palette.selected : statusAccent(agent));
  beacon.position.set(0.94, 0.12, 0.94);
  beacon.castShadow = true;
  beacon.userData.baseY = beacon.position.y;
  beacon.userData.bob = 0.018;
  beacon.userData.spin = 0.035;
  animated.push(beacon);
  group.add(beacon);
}

function addContextBoard(scene, agent, x, z) {
  const board = mesh(new THREE.BoxGeometry(2.35, 1.45, 0.1), 0xf8fafc);
  board.position.set(x, 1.25, z);
  board.rotation.y = -0.36;
  board.castShadow = true;
  scene.add(board);

  const accent = mesh(new THREE.BoxGeometry(1.4, 0.08, 0.025), statusAccent(agent));
  accent.position.set(x - 0.28, 1.52, z - 0.07);
  accent.rotation.y = board.rotation.y;
  scene.add(accent);

  for (let index = 0; index < 4; index += 1) {
    const line = mesh(new THREE.BoxGeometry(1.7 - index * 0.18, 0.035, 0.025), 0x667085);
    line.position.set(x - 0.1, 1.28 - index * 0.18, z - 0.08);
    line.rotation.y = board.rotation.y;
    scene.add(line);
  }
}

function addSignalBoard(scene, agent, x, z, animated) {
  const panel = mesh(new THREE.BoxGeometry(2.0, 0.9, 0.1), 0xffffff);
  panel.position.set(x, 0.78, z);
  panel.rotation.y = -0.22;
  panel.castShadow = true;
  scene.add(panel);

  const childCount = Array.isArray(agent.children) ? agent.children.length : 0;
  [Boolean(agent.parentId), childCount > 0, Boolean(agent.goToTarget)].forEach((active, index) => {
    const dot = mesh(new THREE.IcosahedronGeometry(0.12, 1), active ? statusAccent(agent) : palette.tile);
    dot.position.set(x - 0.55 + index * 0.55, 0.78, z - 0.09);
    dot.userData.baseY = dot.position.y;
    dot.userData.bob = active ? 0.025 : 0.006;
    dot.userData.spin = active ? 0.018 : 0.004;
    animated.push(dot);
    scene.add(dot);
  });
}

function addPlant(scene, x, z, scale) {
  const pot = mesh(new THREE.CylinderGeometry(0.18 * scale, 0.22 * scale, 0.28 * scale, 8), 0x8d5f38);
  pot.position.set(x, 0.14 * scale, z);
  pot.castShadow = true;
  scene.add(pot);
  for (let index = 0; index < 5; index += 1) {
    const leaf = mesh(new THREE.ConeGeometry(0.13 * scale, 0.58 * scale, 5), palette.plant);
    leaf.position.set(x, 0.48 * scale, z);
    leaf.rotation.z = (index - 2) * 0.42;
    leaf.rotation.y = index * 1.26;
    leaf.castShadow = true;
    scene.add(leaf);
  }
}

function addCoffeeTable(scene, x, z) {
  const table = mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.18, 8), 0xc58c5c);
  table.position.set(x, 0.16, z);
  table.castShadow = true;
  scene.add(table);
  const mug = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.12, 8), 0xf8fafc);
  mug.position.set(x + 0.15, 0.32, z - 0.08);
  scene.add(mug);
}

function addBox(group, size, position, boxMaterial) {
  const item = new THREE.Mesh(new THREE.BoxGeometry(...size), boxMaterial);
  item.position.set(...position);
  item.castShadow = true;
  item.receiveShadow = true;
  group.add(item);
  return item;
}

function mesh(geometry, color) {
  const item = new THREE.Mesh(geometry, material(color));
  item.castShadow = true;
  item.receiveShadow = true;
  return item;
}

function material(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.78,
    metalness: 0.04,
    flatShading: true
  });
}

function statusFloor(agent) {
  const tone = statusTone(agent);
  if (tone === "good") return 0xdfeee2;
  if (tone === "warn") return 0xefe2bd;
  if (tone === "done") return 0xdde5ef;
  return 0xe4e7ec;
}

function statusAccent(agent) {
  const tone = statusTone(agent);
  if (tone === "good") return palette.running;
  if (tone === "warn") return palette.waiting;
  if (tone === "done") return palette.done;
  return palette.idle;
}

function statusTone(agent) {
  const status = String(agent.status || "").toLowerCase();
  if (["running", "active", "in-progress", "processing"].includes(status)) return "good";
  if (["waiting", "queued", "paused", "pending"].includes(status)) return "warn";
  if (["ended", "complete", "completed", "cancelled", "failed"].includes(status)) return "done";
  return "idle";
}
