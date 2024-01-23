import { CusLog } from "../utils/tools";
import type { StorageEngine } from "../asyncStorage";

export function ECookie(name = "LS") {
  let ready = false;
  try {
    const testString = "test=test";
    document.cookie = testString;
    if (document.cookie.includes(testString)) {
      ready = true;
    }
  } catch (error) {
    CusLog.error("ECookie", "unready", error);
  }

  if (!ready) {
    return null;
  }

  const storageEngine: StorageEngine<false> = {
    supportObject: false,
    getItem(key) {
      return (
        decodeURIComponent(
          document.cookie.replace(
            new RegExp(
              "(?:(?:^|.*;)\\s*" +
                encodeURIComponent(`${name}_${key}`).replace(
                  /[-.+*]/g,
                  "\\$&"
                ) +
                "\\s*\\=\\s*([^;]*).*$)|^.*$"
            ),
            "$1"
          )
        ) || null
      );
    },
    setItem(key, value) {
      const sExpires = "; expires=Fri, 31 Dec 9999 23:59:59 GMT";
      document.cookie =
        encodeURIComponent(`${name}_${key}`) +
        "=" +
        encodeURIComponent(value) +
        sExpires +
        "; secure";
    },
    removeItem(key) {
      document.cookie =
        encodeURIComponent(`${name}_${key}`) +
        "=; expires=Thu, 01 Jan 1970 00:00:00 GMT";
    },
  };

  return storageEngine;
}
