import "./style.css";
import { Boot } from "./boot";

const canvas = document.querySelector("#stage");
if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error("Missing #stage canvas");
}

const boot = new Boot();
boot.show("Downloading the studio…", 0.08);

try {
  const { startStudio } = await import("./studio");
  boot.show("Opening the lawn…", 0.18);
  await Boot.frame();
  await startStudio(canvas, boot);
} catch (error) {
  console.error(error);
  boot.fail(error);
}
