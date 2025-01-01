// for Kiwi Browser
// https://zenn.dev/snowcait/articles/cb3cb764658100
if (!URL.canParse) {
	URL.canParse = (url: string | URL, base?: string | URL): boolean => {
		try {
			new URL(url, base);
			return true;
		} catch {
			return false;
		}
	};
}
