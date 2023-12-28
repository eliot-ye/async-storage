import MD5Hash from "crypto-js/md5";
import AES from "crypto-js/aes";
import Utf8 from "crypto-js/enc-utf8";

export function MD5(message: string) {
  return MD5Hash(message).toString();
}

export function AESEncrypt(message: string, key: string) {
  return AES.encrypt(message, key).toString();
}
export function AESDecrypt(message: string, key: string) {
  return AES.decrypt(message, key).toString(Utf8);
}
