import AES from "crypto-js/aes";
import Utf8 from "crypto-js/enc-utf8";

/**
 * 序列化
 * @param data - 需要序列化的数据
 * @param secretPassphrase - 加密密钥，如果为空，则不加密
 */
export function stringify(data: any, secretPassphrase: string) {
  if (secretPassphrase) {
    return encrypt(data,secretPassphrase);
  } else {
    return JSON.stringify(data);
  }
}

/**
 * 反序列化
 * @param str - 需要反序列化的字符
 * @param secretPassphrase - 解密密钥，如果为空，则不解密
 */
export function parse(str: any, secretPassphrase: string) {
  if (secretPassphrase) {
    return decrypt(str,secretPassphrase);
  } else {
    return JSON.parse(str);
  }
}

export function encrypt(data: any, secretPassphrase: string){
  return AES.encrypt(JSON.stringify(data), secretPassphrase).toString();
}

export function decrypt(str: any, secretPassphrase: string){
  return JSON.parse(AES.decrypt(str, secretPassphrase).toString(Utf8));
}