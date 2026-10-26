import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { useJsonStore } from "./stores/jsonStore";
import "./styles/index.css";

// 开发模式下暴露 store，便于调试与自动化验证
if (import.meta.env.DEV) {
  (window as unknown as { __fileViewStore?: typeof useJsonStore }).__fileViewStore = useJsonStore;
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
