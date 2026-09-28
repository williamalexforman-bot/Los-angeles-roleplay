declare module 'dotenv' {
  export interface DotenvConfigOutput {
    parsed?: Record<string, string>;
  }

  export function config(options?: unknown): DotenvConfigOutput;

  const dotenv: {
    config(options?: unknown): DotenvConfigOutput;
  };

  export default dotenv;
}

declare namespace NodeJS {
  interface ProcessEnv {
    [key: string]: string | undefined;
  }
}

declare const process: {
  env: NodeJS.ProcessEnv;
};
