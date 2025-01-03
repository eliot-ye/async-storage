import "./style.css";
import { createAsyncStorage, EIndexedDB, ELocalStorage } from "../libs";
import { AESDecrypt, AESEncrypt } from "./utils/encoding";

const LS = createAsyncStorage(
  {
    counter: 0,
    a: "a",
    b: "b",
    testObject: { a: 1, b: 2 },
  },
  [EIndexedDB(), ELocalStorage()]
);

document.querySelector<HTMLDivElement>("#app")!.innerHTML = `
  <div>
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
  LS.subscribe(async () => {
    const counter = await LS.get("counter");
    console.log("subscribe counter:", counter);
  }, ["counter"]);
  for (let index = 0; index < 10; index++) {
    const counter = await LS.get("counter");
    await LS.set("counter", counter + 1);
  }
  setupCounter(document.querySelector<HTMLButtonElement>("#counter")!);
  setupTestObject(document.querySelector<HTMLButtonElement>("#testObject")!);
});

const LSSecret = createAsyncStorage(
  {
    counter: 0,
    a: "a",
    b: "b",
    testObject: { a: 1, b: 2 },
  },
  [EIndexedDB("LSSecret")],
  {
    secretKey: "123456",
    DecryptFn: AESDecrypt,
    EncryptFn: AESEncrypt,
    enableHashKey: true,
  }
);
LSSecret.onReady().then(async () => {
  await LSSecret.set("a", "a2");
  console.log(await LSSecret.get("a"));
});
