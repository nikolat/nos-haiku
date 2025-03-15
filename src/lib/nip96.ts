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
