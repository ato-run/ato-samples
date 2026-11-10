// The Excalidraw scene is this App's own document; Ato stores it opaquely.
// The handlers are the only code that sees the document, so a consumer app can
// be granted a narrow projection without ever reading the scene.
const EMPTY_SCENE = { elements: [], appState: {}, files: {} };

function documentOf(state) {
  return state && state.document && typeof state.document === "object"
    ? state.document
    : {};
}

function sceneOf(state) {
  const document = documentOf(state);
  const scene = document.scene;
  return scene && typeof scene === "object" ? scene : null;
}

function validScene(scene) {
  return (
    scene &&
    typeof scene === "object" &&
    Array.isArray(scene.elements) &&
    (scene.appState == null || typeof scene.appState === "object") &&
    (scene.files == null || typeof scene.files === "object")
  );
}

export function loadScene({ state }) {
  return { operations: [], result: { scene: sceneOf(state) ?? EMPTY_SCENE } };
}

export function saveScene({ arguments: args, state }) {
  const scene = args && args.scene;
  if (!validScene(scene)) throw new Error("scene must be {elements, appState?, files?}");
  return {
    operations: [{ kind: "replace", value: { schemaVersion: 1, scene } }],
    result: { saved: true, element_count: scene.elements.length },
  };
}

export function exportScene({ state }) {
  return { operations: [], result: { scene: sceneOf(state) ?? EMPTY_SCENE } };
}
