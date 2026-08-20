import { useEffect, useMemo, useState } from 'react';
import {
  configureChains,
  createConfig,
  useAccount,
  useConnect,
  useDisconnect,
  useNetwork,
  useWalletClient,
  useContractRead,
  WagmiConfig
} from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { publicProvider } from 'wagmi/providers/public';
import { WalletConnectConnector } from '@wagmi/core/connectors/walletConnect';
import { ethers } from 'ethers';
import type { WalletClient } from 'viem';
import {
  SUPABASE_URL,
  SUPABASE_ANON_KEY,
  WALLETCONNECT_PROJECT_ID,
  VAULT_CONTRACT_ADDRESS,
  VAULT_ABI
} from './config';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const { publicClient } = configureChains([sepolia], [publicProvider()]);
const wagmiConfig = createConfig({
  autoConnect: true,
  publicClient,
  connectors: [
    new WalletConnectConnector({
      chains: [sepolia],
      options: {
        projectId: WALLETCONNECT_PROJECT_ID,
        showQrModal: true
      }
    })
  ]
});

/** Convert a viem WalletClient to an ethers v6 Signer */
function walletClientToSigner(walletClient: WalletClient): ethers.JsonRpcSigner {
  const { account, chain, transport } = walletClient;
  const network = chain
    ? { chainId: chain.id, name: chain.name }
    : undefined;
  const provider = new ethers.BrowserProvider(transport as ethers.Eip1193Provider, network);
  return provider.getSigner(account?.address) as unknown as ethers.JsonRpcSigner;
}

const plans = [
  { id: 1, name: 'Flex', lockDays: 30, rewardBps: 500 },
  { id: 2, name: 'Growth', lockDays: 90, rewardBps: 1000 },
  { id: 3, name: 'Diamond', lockDays: 180, rewardBps: 1800 }
];

function App() {
  const { address } = useAccount();
  const { connect, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const network = useNetwork();
  const { data: walletClient } = useWalletClient();

  const [selectedPlanId, setSelectedPlanId] = useState<number>(1);
  const [depositAmount, setDepositAmount] = useState('0.01');
  const [price, setPrice] = useState<number | null>(null);
  const [status, setStatus] = useState('');

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) ?? plans[0],
    [selectedPlanId]
  );
  const contractAddress = (VAULT_CONTRACT_ADDRESS || '') as `0x${string}`;
  const isSepolia = network.chain?.id === sepolia.id;

  const { data: depositCount } = useContractRead({
    address: contractAddress,
    abi: VAULT_ABI,
    functionName: 'getDepositCount',
    args: address ? ([address] as const) : undefined,
    enabled: Boolean(address && VAULT_CONTRACT_ADDRESS)
  });

  useEffect(() => {
    fetch('http://localhost:4000/price')
      .then((res) => res.json())
      .then((data) => setPrice(data.usd))
      .catch(() => setPrice(null));
  }, []);

  async function savePlanChoice(walletAddress: string, planId: number) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      setStatus('Supabase not configured.');
      return;
    }

    const { error } = await supabase.from('plan_choices').upsert({
      wallet_address: walletAddress,
      plan_id: planId,
      updated_at: new Date().toISOString()
    });

    if (error) {
      setStatus(`Supabase error: ${error.message}`);
      return;
    }

    setStatus('Plan choice saved to Supabase.');
  }

  async function depositToVault() {
    if (!address || !walletClient) {
      setStatus('Connect your wallet first.');
      return;
    }

    if (!VAULT_CONTRACT_ADDRESS) {
      setStatus('Vault contract address not configured.');
      return;
    }

    const amount = Number(depositAmount);
    if (!amount || amount <= 0) {
      setStatus('Enter a valid deposit amount.');
      return;
    }

    if (!isSepolia) {
      setStatus('Switch your wallet to Sepolia before depositing.');
      return;
    }

    try {
      setStatus('Sending deposit transaction...');
      const signer = await walletClientToSigner(walletClient);
      const contract = new ethers.Contract(contractAddress, VAULT_ABI, signer);
      const value = ethers.parseEther(depositAmount);
      const tx = await contract.deposit(selectedPlan.id, { value });
      setStatus('Transaction sent. Waiting for confirmation...');
      await tx.wait();
      setStatus('Deposit confirmed on Sepolia!');
      await savePlanChoice(address, selectedPlan.id);
    } catch (error) {
      setStatus(`Deposit failed: ${(error as Error).message}`);
    }
  }

  return (
    <WagmiConfig config={wagmiConfig}>
      <div className="page-shell">
        <header>
          <div>
            <h1>Vault Testnet Demo</h1>
            <p>Crypto investment demo. No funds held by platform; contract locks deposits.</p>
            <span className="demo-pill">Sepolia testnet demo</span>
          </div>
          <div className="header-actions">
            {address ? (
              <>
                <span className="chip">{address}</span>
                <button onClick={() => disconnect()}>Disconnect</button>
              </>
            ) : (
              connectors.map((connector) => (
                <button
                  key={connector.id}
                  onClick={() => connect({ connector })}
                  disabled={!connector.ready}
                >
                  {connector.name}
                </button>
              ))
            )}
          </div>
        </header>

        {address && !isSepolia ? (
          <div className="network-warning">Please switch your wallet to Sepolia for this demo.</div>
        ) : null}

        <main>
          <section className="panel">
            <h2>Choose a plan</h2>
            <div className="plan-grid">
              {plans.map((plan) => (
                <button
                  key={plan.id}
                  className={plan.id === selectedPlanId ? 'plan-card active' : 'plan-card'}
                  onClick={() => setSelectedPlanId(plan.id)}
                >
                  <h3>{plan.name}</h3>
                  <p>{plan.lockDays} days lock</p>
                  <p>~{plan.rewardBps / 100}% return</p>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2>Deposit</h2>
            <div className="form-row">
              <label>Amount (ETH)</label>
              <input value={depositAmount} onChange={(event) => setDepositAmount(event.target.value)} />
            </div>
            <div className="form-row">
              <label>Selected plan</label>
              <div>{selectedPlan.name}</div>
            </div>
            <div className="button-row">
              <button disabled={!address || !WALLETCONNECT_PROJECT_ID} onClick={depositToVault}>
                Deposit to Vault
              </button>
              <button
                disabled={!address}
                onClick={async () => address && savePlanChoice(address, selectedPlan.id)}
              >
                Save Plan Choice
              </button>
            </div>
            <p className="status">{status}</p>
            {depositCount !== undefined ? (
              <p>Active vault deposits: {depositCount.toString()}</p>
            ) : null}
          </section>

          <section className="panel">
            <h2>Demo dashboard</h2>
            {price ? <p>ETH price: ${price.toFixed(2)}</p> : <p>Loading price...</p>}
            <p>Selected plan: {selectedPlan.name}</p>
            <p>Projected return: {(selectedPlan.rewardBps / 100).toFixed(2)}%</p>
            <p>Unlock in: {selectedPlan.lockDays} days</p>
            <p>Estimated value: {depositAmount} ETH + reward</p>
          </section>
        </main>
      </div>
    </WagmiConfig>
  );
}

export default App;
