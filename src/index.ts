import { engine, initOption } from "./types"
import { LOCAL_STORAGE, localStorageEngine } from "./engine/localStorage"
import { INDEX_DB, indexDBEngine } from "./engine/indexDB"

interface createOpt {
  name: string,
  engineNameList?: string[],
  storeName?: string
}

export const engineNames = { LOCAL_STORAGE, INDEX_DB }

const engineList: { [key: string]: (opt: initOption) => engine } = {
  [LOCAL_STORAGE]: localStorageEngine,
  [INDEX_DB]: indexDBEngine
}

export function defineEngine(engineName: string, engine: () => engine) {
  engineList[engineName] = engine
}

export function createLocalDB(createOpt: createOpt) {
  const _engineNameList = createOpt.engineNameList || Object.values(engineNames);
  let engineObj = engineList[_engineNameList[0]]({ name: createOpt.name, storeName: createOpt.storeName });
  if (!engineObj.support) {
    for (let i = 1; i < _engineNameList.length; i++) {
      engineObj = engineList[_engineNameList[i]]({ name: createOpt.name, storeName: createOpt.storeName })
      if (engineObj.support) break;
    }
  }
  const publicEngine: engine = {
    setItem: engineObj.setItem,
    getItem: engineObj.getItem,
    length: engineObj.length,
    keys: engineObj.keys,
    removeItem: engineObj.removeItem,
    clear: engineObj.clear
  }
  return publicEngine
}
