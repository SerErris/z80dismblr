import assert = require('assert');
import * as path from 'path';
import { execSync } from 'child_process';

const REPO_ROOT = path.join(__dirname, '../..');
const SCRIPT    = path.join(REPO_ROOT, 'src/tests/smoke_pipeline.sh');

suite('Smoke pipeline — steps 6.2–6.5', () => {

	test('pipeline exits 0 (disassemble → golden diff → binary round-trip)', () => {
		let output: string;
		try {
			output = execSync(`bash "${SCRIPT}"`, {
				cwd: REPO_ROOT,
				encoding: 'utf8',
				stdio: ['ignore', 'pipe', 'pipe'],
			});
		} catch (e: any) {
			assert.fail(
				`smoke_pipeline.sh failed (exit ${e.status}):\n${e.stderr ?? ''}\n${e.stdout ?? ''}`,
			);
		}
		// stdout must contain at least the golden-diff confirmation
		assert.ok(output.includes('Golden diff: OK'), `expected "Golden diff: OK" in output:\n${output}`);
	});

});
