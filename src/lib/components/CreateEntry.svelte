<script lang="ts">
	import { defaultAccountUri, getRoboHashURL } from '$lib/config';
	import { getEmoji, type ChannelContent } from '$lib/utils';
	import { uploadFile } from '$lib/nip96';
	import { getChannelEventMap, getEventEmojiSet, sendNote } from '$lib/resource.svelte';
	import type { EventTemplate, NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';
	import { readServerConfig, type OptionalFormDataFields } from 'nostr-tools/nip96';
	import { getToken } from 'nostr-tools/nip98';
	import type { ProfileContent } from 'applesauce-core/helpers';

	let {
		loginPubkey,
		currentChannelId,
		eventToReply,
		profileMap,
		uploaderSelected,
		channelToPost,
		showForm = $bindable()
	}: {
		loginPubkey: string | undefined;
		currentChannelId?: string | undefined;
		eventToReply?: NostrEvent;
		profileMap: Map<string, ProfileContent>;
		uploaderSelected: string;
		channelToPost: ChannelContent | undefined;
		showForm: boolean;
	} = $props();

	let filesToUpload: FileList | undefined = $state();
	let inputFile: HTMLInputElement;
	let textArea: HTMLTextAreaElement;

	const channelEventMap: Map<string, NostrEvent> = $derived(getChannelEventMap());
	const eventEmojiSet: NostrEvent[] = $derived(getEventEmojiSet());
	const emojiMap: Map<string, string> = $derived.by(() => {
		const r = new Map<string, string>();
		for (const ev of eventEmojiSet) {
			const emojiTags: string[][] = ev.tags.filter(
				(tag) =>
					tag.length >= 3 && tag[0] === 'emoji' && /^\w+$/.test(tag[1]) && URL.canParse(tag[2])
			);
			for (const emojiTag of emojiTags) {
				r.set(emojiTag[1], emojiTag[2]);
			}
		}
		return r;
	});

	let emojiPickerContainer: HTMLElement | undefined = $state();
	const callGetEmoji = async () => {
		if (emojiPickerContainer === undefined) {
			return;
		}
		const r = await getEmoji(emojiPickerContainer, $state.snapshot(emojiMap));
		if (r === null) {
			return;
		}
		insertText(r.emojiStr);
	};

	let isInProcess: boolean = $state(false);

	const uploadFileExec = async () => {
		if (filesToUpload === undefined || filesToUpload.length === 0) {
			return;
		}
		const nostr = window.nostr;
		if (nostr === undefined) {
			return;
		}
		isInProcess = true;
		const f = (e: EventTemplate) => nostr.signEvent(e);
		const c = await readServerConfig(uploaderSelected);
		const s = await getToken(c.api_url, 'POST', f, true);
		let file: File | undefined;
		for (const f of filesToUpload ?? []) {
			file = f;
		}
		if (file === undefined) {
			isInProcess = false;
			return;
		}
		const option: OptionalFormDataFields = {
			size: String(file.size),
			content_type: file.type
		};
		const fileUploadResponse = await uploadFile(file, c.api_url, s, option);
		isInProcess = false;
		const uploadedFileUrl = fileUploadResponse.nip94_event?.tags
			.find((tag) => tag[0] === 'url')
			?.at(1);
		if (uploadedFileUrl === undefined) {
			return;
		}
		insertText(uploadedFileUrl);
	};

	const insertText = (word: string): void => {
		let sentence = textArea.value;
		const len = sentence.length;
		const pos = textArea.selectionStart;
		const before = sentence.slice(0, pos);
		const after = sentence.slice(pos, pos + len);
		sentence = before + word + after;
		textArea.value = sentence;
		textArea.focus();
		textArea.selectionStart = pos + word.length;
		textArea.selectionEnd = pos + word.length;
		contentToSend = sentence;
	};

	let channelNameToCreate: string = $state('');
	let contentToSend: string = $state('');
	$effect(() => {
		if (channelToPost !== undefined) {
			channelNameToCreate = channelToPost.name;
		}
	});

	const callSendNote = () => {
		const targetEventToReply =
			channelToPost?.eventkind40 ??
			eventToReply ??
			(currentChannelId !== undefined ? channelEventMap.get(currentChannelId) : undefined);
		sendNote(contentToSend, channelNameToCreate, targetEventToReply, emojiMap).then(() => {
			contentToSend = '';
			channelNameToCreate = '';
			showForm = false;
		});
	};
</script>

<div class="CreateEntry">
	<a
		href="/{loginPubkey === undefined ? '' : nip19.npubEncode(loginPubkey)}"
		class="CreateEntry__profile"
		><img
			src={loginPubkey === undefined
				? defaultAccountUri
				: (profileMap.get(loginPubkey)?.picture ?? getRoboHashURL(nip19.npubEncode(loginPubkey)))}
			class="Avatar"
			alt=""
		/></a
	>
	<div class="CreateEntry__main">
		<div class="InputGroup">
			{#if currentChannelId === undefined && eventToReply === undefined}
				<div class="vue-simple-suggest Input CreateEntry__keyword">
					<div
						aria-haspopup="listbox"
						aria-owns="19-suggestions"
						aria-expanded="false"
						class="input-wrapper"
					>
						<input
							placeholder="キーワードを新規作成 (オプション)"
							disabled={channelToPost !== undefined}
							class="default-input Input"
							aria-autocomplete="list"
							aria-controls="19-suggestions"
							bind:value={channelNameToCreate}
						/>
						{#if channelNameToCreate.length > 0}
							<span class="channel-clear">
								<button
									class="channel-clear"
									title="clear the channel"
									onclick={() => {
										channelToPost = undefined;
										channelNameToCreate = '';
									}}
									aria-label="clear the channel"
								>
									<svg
										xmlns="http://www.w3.org/2000/svg"
										width="16"
										height="16"
										viewBox="0 0 16 16"
									>
										<path
											fill-rule="evenodd"
											d="M8,16 C3.581722,16 0,12.418278 0,8 C0,3.581722 3.581722,0 8,0 C12.418278,0 16,3.581722 16,8 C16,12.418278 12.418278,16 8,16 Z M8,14 C11.3137085,14 14,11.3137085 14,8 C14,4.6862915 11.3137085,2 8,2 C4.6862915,2 2,4.6862915 2,8 C2,11.3137085 4.6862915,14 8,14 Z M8,9.41421356 L5.70710678,11.7071068 L4.29289322,10.2928932 L6.58578644,8 L4.29289322,5.70710678 L5.70710678,4.29289322 L8,6.58578644 L10.2928932,4.29289322 L11.7071068,5.70710678 L9.41421356,8 L11.7071068,10.2928932 L10.2928932,11.7071068 L8,9.41421356 Z"
										/>
									</svg>
								</button>
							</span>
						{/if}
					</div>
				</div>
			{/if}
			<div
				class="RichTextEditor CreateEntry__text"
				data-is-active="true"
				data-is-guest-preview-mode="true"
			>
				<div class="RichTextEditor__toolbar ql-toolbar" style="">
					<span class="ql-formats">
						<span class="ql-formats"
							><button
								aria-label="画像を追加"
								title="画像を追加"
								class="ToolbarItem ql-image"
								onclick={() => inputFile.click()}
								disabled={isInProcess}
								type="button"><i class="fa-fw far fa-camera"></i></button
							>
							<input
								class="select-upload-file"
								type="file"
								accept="image/*,video/*,audio/*"
								bind:this={inputFile}
								bind:files={filesToUpload}
								onchange={uploadFileExec}
							/>
							<button
								aria-label="絵文字を追加"
								title="絵文字を追加"
								class="ToolbarItem ql-emoji"
								type="button"
								onclick={() => {
									callGetEmoji();
								}}><i class="fa-fw far fa-smile-plus"></i></button
							></span
						>
					</span>
					<div class="emoji-picker-container" bind:this={emojiPickerContainer}></div>
				</div>
				<div translate="no" class="RichTextEditor__editor notranslate ql-container">
					<textarea
						class="ql-editor ql-blank"
						bind:this={textArea}
						bind:value={contentToSend}
						onkeydown={(e: KeyboardEvent) => {
							if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
								callSendNote();
							}
						}}
					></textarea>
					<div class="ql-clipboard" contenteditable="true" tabindex="-1"></div>
				</div>
				<input type="file" style="display: none;" />
			</div>
		</div>
		<div class="CreateEntry__actions">
			<button class="Button" disabled={contentToSend.length === 0} onclick={callSendNote}
				><span>投稿</span></button
			>
			{#if eventToReply !== undefined}
				<button
					class="Button Button--cancel"
					onclick={() => {
						showForm = false;
					}}><span> キャンセル </span></button
				>
			{/if}
		</div>
	</div>
</div>

<style>
	textarea {
		appearance: none;
		background: transparent;
		border: none;
		border-radius: 0;
		font: inherit;
		outline: none;
		width: 100%;
		resize: none;
	}
	.select-upload-file {
		display: none;
	}
	.emoji-picker-container {
		position: absolute;
		top: 2em;
		left: -3em;
	}
	span.channel-clear {
		position: absolute;
		right: 10px;
		top: 3px;
	}
	span.channel-clear > button {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
	}
	span.channel-clear > button:disabled {
		cursor: not-allowed;
	}
	span.channel-clear > button.channel-clear {
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
	}
	span.channel-clear > button.channel-clear > svg {
		width: 16px;
		height: 16px;
		fill: gray;
	}
	span.channel-clear > button.channel-clear:active > svg {
		fill: yellow;
	}
</style>
