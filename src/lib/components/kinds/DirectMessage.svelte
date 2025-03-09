<script lang="ts">
	import Content from '$lib/components/Content.svelte';
	import { _ } from 'svelte-i18n';

	const {
		content,
		loginPubkey,
		currentPubkey,
		pubkeyToSend
	}: {
		content: string;
		loginPubkey: string | undefined;
		currentPubkey: string;
		pubkeyToSend: string | undefined;
	} = $props();

	let decryptedContent: string | undefined = $state();
</script>

{#if loginPubkey !== undefined && pubkeyToSend !== undefined && [currentPubkey, pubkeyToSend].includes(loginPubkey)}
	<button
		class="Button"
		disabled={decryptedContent !== undefined}
		onclick={async () => {
			const pubkey = loginPubkey === currentPubkey ? pubkeyToSend : currentPubkey;
			try {
				decryptedContent = await window.nostr?.nip04?.decrypt(pubkey, content);
			} catch (error) {
				console.warn(error);
			}
		}}><span>{$_('DirectMessage.decrypt')}</span></button
	>
{/if}
<p>
	<Content content={decryptedContent ?? content} tags={[]} />
</p>
