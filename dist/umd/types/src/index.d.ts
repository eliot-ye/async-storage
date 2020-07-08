import { engine } from "./types";
interface createOpt {
    name: string;
    engineNameList?: string[];
    storeName?: string;
}
export declare const engineNames: {
    LOCAL_STORAGE: string;
    INDEX_DB: string;
};
export declare function defineEngine(engineName: string, engine: () => engine): void;
export declare function createLocalDB(createOpt: createOpt): engine;
export {};
