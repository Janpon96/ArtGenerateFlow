import { FLOW_ASSISTED_ADAPTER_VERSION } from '@frs/provider-flow-web';

document.getElementById('open')!.addEventListener('click', () => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('workbench.html') });
});
document.getElementById('status')!.textContent = `Adapter: ${FLOW_ASSISTED_ADAPTER_VERSION}. G0 live chưa chạy.`;
