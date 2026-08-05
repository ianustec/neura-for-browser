let agentAborted = false;

export function setAgentAborted(value = true) {
  agentAborted = !!value;
}

export function getAgentAborted() {
  return agentAborted;
}

export function resetAgentAborted() {
  agentAborted = false;
}
