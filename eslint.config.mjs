import next from "eslint-config-next";

const config = [{ ignores: [".next/**", "node_modules/**", "reports/**", "data/**"] }, ...next];
export default config;
