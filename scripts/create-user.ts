import { createUser } from "../src/lib/auth";
import { migrate } from "../src/lib/db";
import { positionalArgs } from "./cli-args";
const [username, password, role] = positionalArgs();
if (!username || !password || !["admin", "computer_reviewer", "math_reviewer"].includes(role))
  throw new Error("usage: pnpm tsx scripts/create-user.ts username password role");
migrate();
createUser(username, password, role as any);
console.log(`created ${username} (${role})`);
