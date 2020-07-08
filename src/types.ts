

export interface initOption {
  name: string,
  storeName: string | undefined
}

export interface engine {
  support?: boolean
  length(): Promise<number>
  keys(): Promise<string[]>
  removeItem(key:string): Promise<void>
  clear(): Promise<void>
  /**
   * @param key
   * @param value
   */
  setItem(key:string, value:any): Promise<void>
  /**
   * @param key
   */
  getItem(key: string): Promise<any>
}
