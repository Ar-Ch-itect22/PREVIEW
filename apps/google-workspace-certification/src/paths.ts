import { resolve } from 'node:path';

export const gateSevenDirectory = resolve('.preview', 'gate7');
export const preparedArtifactPath = resolve(gateSevenDirectory, 'prepared.json');
export const sagaDirectory = resolve(gateSevenDirectory, 'saga');
