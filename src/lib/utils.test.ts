import { isCustomEmoji } from '$lib/utils';
import type { NostrEvent } from 'nostr-tools';
import { describe, it, expect } from 'vitest';

describe('emoji test', () => {
	it('emoji tag should be one', () => {
		const reactionEvent: NostrEvent = {
			content: ':3x1_ari_:',
			created_at: 1760307979,
			id: '2eadcc544c926b322dd2df9548d6df1f55985e4b9f2293412f0b9e2881fec1c3',
			kind: 7,
			pubkey: 'c08805f9bd4849049325747a8086a3c0e069adeb19d8f59ec4e6b5157b7d3416',
			sig: '39aa32ed66cffa417fafb64de0ef022c06585dee289379a2df6eee0050f46e0e158a93621ecefd04af558c1c89418e725690a4e0c0dc28127d2e55d86eb99c6e',
			tags: [
				[
					'emoji',
					'3x1_ari_',
					'https://raw.githubusercontent.com/mitsugu/customemoji/main/text/3.1.ari-.webp'
				],
				['e', '8e0a3174343fffb5b1f48cc2ad8ca5a017ad429a4fee20bcedcf0da8a6813c84'],
				['p', '6b0a60cff3eca5a2b2505ccb3f7133d8422045cbef40f3d2c6189fb0b952e7d4'],
				['k', '7'],
				[
					'emoji',
					'3x1_ari_',
					'https://raw.githubusercontent.com/mitsugu/customemoji/main/text/3.1.ari-.webp'
				]
			]
		};
		expect(isCustomEmoji(reactionEvent)).toBe(false);
	});
});
