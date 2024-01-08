import "./style.css";
import typescriptLogo from "./typescript.svg";
import viteLogo from "/vite.svg";
import { createAsyncStorage, EIndexedDB } from "../libs";

const LS = createAsyncStorage(
  {
    counter: 0,
    a: "a",
    b: "b",
    testObject: { a: 1, b: 2 },
  },
  [EIndexedDB()]
);

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
    <a href="https://vitejs.dev" target="_blank">
      <img src="${viteLogo}" class="logo" alt="Vite logo" />
    </a>
    <a href="https://www.typescriptlang.org/" target="_blank">
      <img src="${typescriptLogo}" class="logo vanilla" alt="TypeScript logo" />
    </a>
    <h1>Vite + TypeScript</h1>
    <div class="card">
      <button id="counter" type="button"></button>
    </div>
    <div class="card">
      <button id="testObject" type="button"></button>
    </div>
    <p class="read-the-docs">
      Click on the Vite and TypeScript logos to learn more
    </p>
  </div>
`;

async function setupCounter(element: HTMLButtonElement) {
  let counter = await LS.get("counter");
  const setCounter = async (count: number) => {
    counter = count;
    await LS.set("counter", counter);
    element.innerHTML = `count is ${counter}`;
  };
  element.addEventListener("click", () => setCounter(counter + 1));
  await setCounter(counter);
}

async function setupTestObject(element: HTMLButtonElement) {
  let testObject = await LS.get("testObject");
  const setTestObject = (count: number) => {
    testObject.a = count;
    LS.set("testObject", testObject);
    element.innerHTML = `testObject.a is ${testObject.a}`;
  };
  element.addEventListener("click", () => setTestObject(testObject.a + 1));
  setTestObject(testObject.a);
}

LS.onReady().then(async () => {
  await setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);
  LS.subscribe(async () => {
    const counter = await LS.get("counter");
    console.log("subscribe counter:", counter);
  }, ["counter"]);
  setupTestObject(document.querySelector<HTMLButtonElement>("#testObject")!);
});
