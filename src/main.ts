import "./style.css";
import { mountApp } from "./app";

const root = document.getElementById("app");
if (!root) {
  throw new Error("Missing #app");
}

mountApp(root);

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}

