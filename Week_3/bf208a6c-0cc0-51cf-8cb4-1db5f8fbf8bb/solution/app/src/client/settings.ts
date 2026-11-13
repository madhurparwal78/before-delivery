interface Settings {
  uploadMaxBytes: number;
}

const element = document.getElementById("settings");
if (!element?.textContent) throw new Error("the page carries no settings");

/** Settings the server puts into the page: the upload limit, written into the file-size message. */
export const settings = JSON.parse(element.textContent) as Settings;
