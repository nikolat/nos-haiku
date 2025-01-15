<script lang="ts">
	import { defaultAccountUri, getRoboHashURL } from '$lib/config';
	import { getEmoji, type ChannelContent } from '$lib/utils';
	import { uploadFile } from '$lib/nip96';
	import { getChannelEventMap, getEventEmojiSet, sendNote } from '$lib/resource.svelte';
	import type { EventTemplate, NostrEvent } from 'nostr-tools/pure';
	import * as nip19 from 'nostr-tools/nip19';
	import {
		readServerConfig,
		type FileUploadResponse,
		type OptionalFormDataFields
	} from 'nostr-tools/nip96';
	import { getToken } from 'nostr-tools/nip98';
	import type { ProfileContent } from 'applesauce-core/helpers';

	let {
		loginPubkey,
		currentChannelId,
		eventToReply,
		isTopPage,
		profileMap,
		uploaderSelected,
		channelToPost = $bindable(),
		showForm = $bindable()
	}: {
		loginPubkey: string | undefined;
		currentChannelId?: string | undefined;
		eventToReply?: NostrEvent;
		isTopPage: boolean;
		profileMap: Map<string, ProfileContent>;
		uploaderSelected: string;
		channelToPost: ChannelContent | undefined;
		showForm: boolean;
	} = $props();

	let filesToUpload: FileList | undefined = $state();
	let imetaMap: Map<string, FileUploadResponse> = new Map<string, FileUploadResponse>();
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
		imetaMap.set(uploadedFileUrl, fileUploadResponse);
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
	let addContentWarning: boolean = $state(false);
	let reasonContentWarning: string = $state('');
	let contentToSend: string = $state('');
	$effect(() => {
		if (channelToPost !== undefined) {
			channelNameToCreate = channelToPost.name;
		} else {
			channelNameToCreate = '';
		}
	});

	const callSendNote = () => {
		const targetEventToReply =
			channelToPost?.eventkind40 ??
			eventToReply ??
			(currentChannelId !== undefined ? channelEventMap.get(currentChannelId) : undefined);
		const contentWarningReason = addContentWarning
			? reasonContentWarning.length > 0
				? reasonContentWarning
				: null
			: undefined;
		sendNote(
			contentToSend,
			channelNameToCreate,
			targetEventToReply,
			emojiMap,
			imetaMap,
			contentWarningReason
		).then(() => {
			contentToSend = '';
			channelToPost = undefined;
			channelNameToCreate = '';
			addContentWarning = false;
			reasonContentWarning = '';
			filesToUpload = undefined;
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
							{#if channelToPost !== undefined}
								{@const channel = channelToPost}
								<img
									class="channel-to-post"
									alt=""
									src={URL.canParse(channel.picture ?? '')
										? channel.picture
										: getRoboHashURL(nip19.neventEncode({ id: channel.id }))}
								/>
							{:else}
								<span class="channel-to-post">⚠️新規作成</span>
							{/if}
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
			{#if addContentWarning}
				<div class="vue-simple-suggest Input CreateEntry__content_warning CreateEntry__keyword">
					<div class="input-wrapper">
						<input
							placeholder="警告の理由 (オプション)"
							class="default-input-cw Input"
							bind:value={reasonContentWarning}
						/>
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
								onclick={callGetEmoji}><i class="fa-fw far fa-smile-plus"></i></button
							><button
								aria-label="Content Warning"
								title="Content Warning"
								class={addContentWarning ? 'ToolbarItem ql-cw on' : 'ToolbarItem ql-cw'}
								type="button"
								onclick={() => {
									addContentWarning = !addContentWarning;
								}}
								><svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24">
									<path
										fill-rule="evenodd"
										d="M15.4362056,3.97761907 L22.4415418,15.9531803 C23.1705647,17.1855523 23.1862871,18.7132183 22.4827809,19.960327 C21.7784409,21.2089137 20.4619131,21.9842458 19.0122617,21.9983464 L4.97439311,21.9982802 C3.53965557,21.9866122 2.22062199,21.2088986 1.51617253,19.9591997 C0.812307653,18.7105379 0.82874719,17.1794759 1.55542122,15.9576183 L8.56335758,3.97766866 C9.27539851,2.75195566 10.5866895,1.99834312 12.0044595,2.00000273 C13.4220774,2.00166216 14.7329114,2.75839786 15.4362056,3.97761907 Z M10.2912062,4.98490751 L3.27807854,16.973689 C2.91426165,17.5854502 2.90603166,18.3519329 3.25843298,18.9770956 C3.61122214,19.6029463 4.27192295,19.9925012 4.98252774,19.9983133 L19.0025048,19.998394 C19.7286764,19.9913068 20.3881019,19.6029566 20.7408294,18.977675 C21.0930548,18.3532834 21.0851837,17.588488 20.7176978,16.9672502 L13.7068317,4.98222313 C13.357551,4.37673307 12.7063962,4.00082577 12.0021183,4.00000136 C11.2977596,3.99917685 10.6463678,4.37353845 10.2912062,4.98490751 Z M12.0003283,17.9983464 C11.4478622,17.9983464 11,17.5506311 11,16.9983464 C11,16.4460616 11.4478622,15.9983464 12.0003283,15.9983464 C12.5527943,15.9983464 13.0006565,16.4460616 13.0006565,16.9983464 C13.0006565,17.5506311 12.5527943,17.9983464 12.0003283,17.9983464 Z M11.0029544,7.99834639 L13.0036109,7.99834639 L13.0036109,14.9983464 L11.0029544,14.9983464 L11.0029544,7.99834639 Z"
									/>
								</svg></button
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
			<button
				class="Button"
				disabled={contentToSend.length === 0 || (isTopPage && channelNameToCreate.length === 0)}
				onclick={callSendNote}><span>投稿</span></button
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
	img.channel-to-post {
		position: absolute;
		top: 8px;
		right: 32px;
		width: auto;
		height: 24px;
		object-fit: cover;
		border-radius: 10%;
	}
	span.channel-to-post {
		position: absolute;
		top: 0px;
		right: 32px;
	}
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
	span.channel-clear > button,
	button.ToolbarItem {
		border: none;
		outline: none;
		padding: 0;
		height: 16px;
		cursor: pointer;
		margin: 0;
	}
	span.channel-clear > button:disabled,
	button.ToolbarItem:disabled {
		cursor: not-allowed;
	}
	span.channel-clear > button.channel-clear,
	button.ToolbarItem {
		background-color: rgba(127, 127, 127, 0);
		border-radius: 10%;
	}
	span.channel-clear > button.channel-clear > svg {
		width: 16px;
		height: 16px;
		fill: gray;
	}
	.RichTextEditor__toolbar button.ToolbarItem.ql-cw {
		width: 15px;
		height: 16px;
	}
	button.ToolbarItem > svg {
		margin-bottom: -2px;
		width: 12px;
		height: 12px;
		fill: var(--secondary-text-color);
	}
	span.channel-clear > button.channel-clear:active > svg,
	button.ToolbarItem.on > svg {
		fill: yellow;
	}
	.CreateEntry__keyword + .CreateEntry__keyword .default-input-cw {
		border-radius: 0;
		border-top: 0;
	}
	.CreateEntry__keyword .default-input-cw {
		border-bottom-left-radius: 0;
		border-bottom-right-radius: 0;
	}
</style>
