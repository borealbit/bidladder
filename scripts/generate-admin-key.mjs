import { createHash, randomBytes } from "node:crypto";

const rawKey = randomBytes(32).toString("base64url");
const hash = createHash("sha256").update(rawKey, "utf8").digest("hex");

console.log("BidLadder admin credentials\n");
console.log(`Raw admin key (enter this at /admin):\n${rawKey}\n`);
console.log(`Worker/.dev.vars value:\nADMIN_API_KEY_HASH=${hash}\n`);
console.log("Store the raw key securely. The hash cannot be used to recover it.");
