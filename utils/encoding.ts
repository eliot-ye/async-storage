import { MD5 as MD5Hash, AES, enc } from "crypto-js";

export function MD5(message: string) {
  return MD5Hash(message).toString();
}

export function AESEncrypt(message: string, key: string) {
  return AES.encrypt(message, key).toString();
}
export function AESDecrypt(message: string, key: string) {
  return AES.decrypt(message, key).toString(enc.Utf8);
}
