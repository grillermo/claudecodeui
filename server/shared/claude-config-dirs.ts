import os from 'node:os';
import path from 'node:path';

/**
 * Claude Code keeps transcripts, history and the running-session registry in
 * its config directory. People who run several accounts give each one its own
 * `CLAUDE_CONFIG_DIR`, so one machine can hold several of these directories.
 *
 * `~/.claude` is always included. `CLAUDE_CONFIG_DIR` and the path-delimited
 * `CLAUDE_EXTRA_CONFIG_DIRS` add to it.
 */
export function getClaudeConfigDirs(
  env: NodeJS.ProcessEnv = process.env,
  homeDirectory: string = os.homedir(),
): string[] {
  const candidates = [
    path.join(homeDirectory, '.claude'),
    env.CLAUDE_CONFIG_DIR,
    ...(env.CLAUDE_EXTRA_CONFIG_DIRS ?? '').split(path.delimiter),
  ];

  const directories = candidates
    .map((candidate) => candidate?.trim())
    .filter((candidate): candidate is string => Boolean(candidate))
    .map((candidate) => path.resolve(candidate));

  return [...new Set(directories)];
}

/** The config directory whose `projects/` folder holds this transcript, or null. */
export function findClaudeConfigDirForTranscript(
  jsonlPath: string,
  directories: string[] = getClaudeConfigDirs(),
): string | null {
  const resolvedPath = path.resolve(jsonlPath);
  return directories.find((directory) => (
    resolvedPath.startsWith(`${path.join(directory, 'projects')}${path.sep}`)
  )) ?? null;
}

/**
 * Environment for a CLI that resumes the session stored at `jsonlPath`.
 *
 * The CLI only finds a session, and its account's login, in the config
 * directory that owns it. `~/.claude` is reached by leaving the variable unset,
 * because the CLI files credentials differently once it is set.
 */
export function withClaudeConfigDirForTranscript(
  env: NodeJS.ProcessEnv,
  jsonlPath: string | null | undefined,
  directories: string[] = getClaudeConfigDirs(),
  homeDirectory: string = os.homedir(),
): NodeJS.ProcessEnv {
  const directory = jsonlPath ? findClaudeConfigDirForTranscript(jsonlPath, directories) : null;
  if (!directory) {
    return env;
  }

  const nextEnv = { ...env };
  if (directory === path.resolve(homeDirectory, '.claude')) {
    delete nextEnv.CLAUDE_CONFIG_DIR;
  } else {
    nextEnv.CLAUDE_CONFIG_DIR = directory;
  }
  return nextEnv;
}
