export const VAULT_CONTRACT_ADDRESS = import.meta.env.VITE_VAULT_ADDRESS || '';

export const VAULT_ABI = [
  {
    inputs: [{ internalType: 'uint8', name: 'planId', type: 'uint8' }],
    name: 'deposit',
    outputs: [],
    stateMutability: 'payable',
    type: 'function'
  },
  {
    inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
    name: 'getDepositCount',
    outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function'
  }
] as const;
