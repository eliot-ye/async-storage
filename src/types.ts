

export interface initOption {
  name: string,
  storeName: string | undefined
}

export interface engine {
  support?: boolean
  length(): Promise<number>
  keys(): Promise<string[]>
  removeItem(key:string): Promise<void>
  clean(): Promise<void>
  /**
   * @param key
   * @param value
   * @param secretPassphrase - 加密密钥，如果为空，则不加密
   */
  setItem(key:string, value:any, secretPassphrase?:string): Promise<void>
  /**
   * @param key
   * @param secretPassphrase - 解密密钥，如果为空，则不解密
   */
  getItem(key: string, secretPassphrase?: string): Promise<any>
}
