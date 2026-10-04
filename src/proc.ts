import { spawn } from "node:child_process";

export function runProcess(
  cmd: string,
  args: string[],
  options?: {
    cwd?: string;
    onText?: (chunk: string, stream: "stdout" | "stderr") => void;
  },
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: options?.cwd, windowsHide: true });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stdout += text;
      options?.onText?.(text, "stdout");
    });
    child.stderr.on("data", (buf: Buffer) => {
      const text = buf.toString();
      stderr += text;
      options?.onText?.(text, "stderr");
    });
    child.on("error", (err) => {
      reject(new Error(`${cmd} could not start. ${err.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} failed:\n${(stderr || stdout).slice(-2000)}`));
    });
  });
}
