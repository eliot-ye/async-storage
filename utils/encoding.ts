import { AES, enc, MD5 as MD5Hash } from "crypto-js";
import Base64 from "crypto-js/enc-base64";

export function MD5(message: string) {
  return MD5Hash(message).toString();
}

export function AESEncrypt(message: string, key: string) {
  return AES.encrypt(message, key).toString();
}
export function AESDecrypt(message: string, key: string) {
  return AES.decrypt(message, key).toString(enc.Utf8);
}

export function StringToUint8Array(str: string) {
  const ab = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    ab[i] = str.charCodeAt(i);
  }
  return ab;
}

export function Utf8ToBase64(str: string) {
  return Base64.stringify(enc.Utf8.parse(str));
}
export function Base64ToUtf8(str: string) {
  return Base64.parse(str).toString(enc.Utf8);
}
