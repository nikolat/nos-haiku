import type { FileUploadResponse, OptionalFormDataFields } from 'nostr-tools/nip96';

export async function uploadFile(
	file: File,
	serverApiUrl: string,
	nip98AuthorizationHeader: string,
	optionalFormDataFields?: OptionalFormDataFields
): Promise<FileUploadResponse> {
	// Create FormData object
	const formData = new FormData();

	// Append optional fields to FormData
	Object.entries(optionalFormDataFields ?? {}).forEach(([key, value]) => {
		if (value) {
			formData.append(key, value);
		}
	});

	// Append the file to FormData as the last field
	formData.append('file', file);

	// Make the POST request to the server
	const response = await fetch(serverApiUrl, {
		method: 'POST',
		headers: {
			Authorization: nip98AuthorizationHeader
		},
		body: formData
	});

	if (response.ok === false) {
		// 413 Payload Too Large
		if (response.status === 413) {
			throw new Error('File too large!');
		}

		// 400 Bad Request
		if (response.status === 400) {
			throw new Error('Bad request! Some fields are missing or invalid!');
		}

		// 403 Forbidden
		if (response.status === 403) {
			throw new Error('Forbidden! Payload tag does not match the requested file!');
		}

		// 402 Payment Required
		if (response.status === 402) {
			throw new Error('Payment required!');
		}

		// unknown error
		throw new Error('Unknown error in uploading file!');
	}

	try {
		const parsedResponse = await response.json();

		//if (!validateFileUploadResponse(parsedResponse)) {
		//	throw new Error('Invalid response from the server!')// <- わりとInvalidになる
		//}

		return parsedResponse;
	} catch (_error) {
		throw new Error('Error parsing JSON response!');
	}
}

export async function listFiles(
	serverApiUrl: string,
	nip98AuthorizationHeader: string
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
	// Send the GET request
	const response = await fetch(serverApiUrl, {
		method: 'GET',
		headers: {
			Authorization: nip98AuthorizationHeader
		}
	});

	// Handle the response
	if (!response.ok) {
		throw new Error('Error listing file!');
	}

	// Return the response from the server
	try {
		return await response.json();
	} catch (_error) {
		throw new Error('Error parsing JSON response!');
	}
}

export type FileListResponse = {
	count: number;
	total: number;
	page: number;
	files: [
		{
			tags: Array<[string, string]>;
			content: string;
			created_at: number;
		}
	];
};
