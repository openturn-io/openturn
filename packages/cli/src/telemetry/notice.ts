const BANNER = `\
openturn collects anonymous CLI usage analytics (command, version, OS, error
class) to help prioritize work. No project files, code, paths, tokens, or
identifiable information are collected.

Disable any time:  export DO_NOT_TRACK=1
Details:           https://github.com/openturn-io/openturn/blob/main/TELEMETRY.md
`;

export function printFirstRunNotice(): void {
  process.stderr.write(`\n${BANNER}\n`);
}
