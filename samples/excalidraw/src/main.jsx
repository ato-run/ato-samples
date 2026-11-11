import React, { useCallback, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Excalidraw } from "@excalidraw/excalidraw";
import "@excalidraw/excalidraw/index.css";

const EMPTY_SCENE = { elements: [], appState: {}, files: {} };

/** TOML checkpoints cannot represent null, and Excalidraw emits null for unset
 *  fields; drop them so the DataResource document stays checkpoint-safe. */
function withoutNulls(value) {
  if (Array.isArray(value)) return value.map(withoutNulls).filter((v) => v !== null);
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === null || item === undefined) continue;
      next[key] = withoutNulls(item);
    }
    return next;
  }
  return value;
}
const PROBLEM_NOT_CONNECTED =
  "This scene is not connected to any data yet. Connect data from its app page, then reload.";

function App() {
  const apiRef = useRef(null);
  const sceneRef = useRef(EMPTY_SCENE);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Opening the scene…");
  const [problem, setProblem] = useState("");

  const operations = window.atoInstanceOperations;

  const load = useCallback(async () => {
    if (!operations) {
      setStatus("This app needs to run on an ato runtime to reach your data.");
      return;
    }
    try {
      const result = await operations.invoke("scene_load", {}, crypto.randomUUID());
      const scene = result?.result?.scene;
      sceneRef.current = scene && typeof scene === "object" ? scene : EMPTY_SCENE;
      setStatus("Scene loaded. Changes are saved only when you save a checkpoint.");
      setReady(true);
    } catch (error) {
      setStatus("Your data is not available.");
      setProblem(
        error && error.code === "data_port_not_connected"
          ? PROBLEM_NOT_CONNECTED
          : `Could not read the scene (${(error && error.code) || "scene_unavailable"}).`,
      );
    }
  }, [operations]);

  React.useEffect(() => {
    load();
  }, [load]);

  const onChange = useCallback((elements, appState, files) => {
    sceneRef.current = {
      elements: elements ?? [],
      appState: {
        viewBackgroundColor: appState?.viewBackgroundColor,
        gridSize: appState?.gridSize,
        currentItemStrokeColor: appState?.currentItemStrokeColor,
      },
      files: files ?? {},
    };
  }, []);

  const save = useCallback(async () => {
    if (!operations || busy) return;
    setBusy(true);
    setProblem("");
    try {
      const result = await operations.invoke(
        "scene_save",
        { scene: withoutNulls(sceneRef.current) },
        crypto.randomUUID(),
      );
      setStatus(`Saved ${result?.result?.element_count ?? sceneRef.current.elements.length} elements.`);
    } catch (error) {
      setStatus("Save failed.");
      setProblem(`Could not save the scene (${(error && error.code) || "scene_save_failed"}).`);
    } finally {
      setBusy(false);
    }
  }, [busy, operations]);

  const exportScene = useCallback(async () => {
    if (!operations) return;
    try {
      const result = await operations.invoke("scene_export", {}, crypto.randomUUID());
      const scene = result?.result?.scene ?? sceneRef.current;
      const blob = new Blob([JSON.stringify(scene, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "excalidraw-scene.json";
      link.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      setProblem(`Could not export the scene (${(error && error.code) || "scene_export_failed"}).`);
    }
  }, [operations]);

  return (
    <main className="shell">
      <header className="bar">
        <h1>Excalidraw</h1>
        <p className="status" role="status">{status}</p>
        <div className="actions">
          <button type="button" onClick={save} disabled={!ready || busy}>Save checkpoint</button>
          <button type="button" onClick={exportScene} disabled={!ready}>Export scene</button>
        </div>
      </header>
      {problem ? <p className="problem" role="alert">{problem}</p> : null}
      <div className="canvas">
        {ready ? (
          <Excalidraw
            excalidrawAPI={(api) => { apiRef.current = api; }}
            initialData={sceneRef.current}
            onChange={onChange}
            UIOptions={{ canvasActions: { loadScene: false } }}
          />
        ) : null}
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<App />);
