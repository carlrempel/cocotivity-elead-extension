const version = document.querySelector('#version');
const helloButton = document.querySelector('#hello-button');
const status = document.querySelector('#status');

version.textContent = chrome.runtime.getManifest().version;

helloButton.addEventListener('click', () => {
  status.textContent = 'Hello World! The starter extension is working.';
});
