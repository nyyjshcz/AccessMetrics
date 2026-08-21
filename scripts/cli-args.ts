export function positionalArgs(argv = process.argv.slice(2)) {
  return argv.filter((argument) => argument !== "--");
}
