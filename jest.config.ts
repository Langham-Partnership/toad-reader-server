import type { Config } from 'jest';
import { createDefaultPreset } from 'ts-jest';

const tsJestTransformCfg = createDefaultPreset().transform;

const config: Config = {
  maxWorkers: 3,
  modulePathIgnorePatterns: ['crons'],
  testEnvironment: 'node',
  transform: {
    ...tsJestTransformCfg,
  },
};

export default config;