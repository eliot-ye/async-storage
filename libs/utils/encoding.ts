import { md5 as MD5Hash } from "js-md5";

export function MD5(message: string) {
  return MD5Hash(message).toString();
}
