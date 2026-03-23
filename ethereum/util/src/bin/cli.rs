use std::{fs::read_to_string, path::PathBuf, sync::Arc};

use anyhow::{anyhow, Context};
use clap::Parser;
use ethereum_util::abi::BridgeContractEvents;
use ethers::{
    abi::RawLog,
    contract::EthLogDecode,
    prelude::{
        k256::{elliptic_curve::SecretKey, Secp256k1},
        ContractFactory, Filter, Http, LocalWallet, Middleware, Provider, Signer, SignerMiddleware,
        Solc, StreamExt, H160, U256,
    },
    utils::secret_key_to_address,
};
use serde::Deserialize;

type EthClient = SignerMiddleware<Provider<Http>, LocalWallet>;

#[derive(Clone, Debug, Deserialize)]
pub struct Env {
    eth_node: Option<String>,
    eth_secret: Option<String>,
}

#[derive(Parser)]
enum Command {
    DeployBridge {
        root: PathBuf,
    },
    DeployERC20 {
        root: PathBuf,
        initial_supply: String,
    },
    Address,
    SecretHex,
    WatchEvents {
        contract: String,
    },
    BridgeIn {
        bridge: String,
        token: String,
        amount: String,
        destination_chain: String,
        destination_address: String,
    },
}

impl Env {
    pub fn node(&self) -> Result<&str, anyhow::Error> {
        self.eth_node
            .as_ref()
            .map(|s| s.as_str())
            .ok_or_else(|| anyhow!("missing ETH_NODE"))
    }

    pub fn secret(&self) -> Result<SecretKey<Secp256k1>, anyhow::Error> {
        let path = self
            .eth_secret
            .as_ref()
            .map(|s| s.as_str())
            .ok_or_else(|| anyhow!("missing ETH_SECRET"))?;

        let data = read_to_string(path).context("couldn't read secret file")?;
        let key =
            SecretKey::<Secp256k1>::from_sec1_pem(&data).context("couldn't parse secret file")?;

        Ok(key)
    }
}

async fn make_client(env: &Env) -> anyhow::Result<Arc<EthClient>> {
    let node = env.node()?;
    let secret = env.secret()?;

    let provider = Provider::<Http>::try_from(node.to_string()).context("failed to get client")?;
    let chain_id: u64 = provider
        .get_chainid()
        .await
        .context("couldn't get chainid")?
        .try_into()
        .expect("can't cast u256 to u64");

    let wallet = LocalWallet::from(secret).with_chain_id(chain_id);
    let provider = SignerMiddleware::new(provider, wallet.clone());
    let provider = Arc::new(provider);

    Ok(provider)
}

async fn get_nonce(client: &Arc<EthClient>) -> U256 {
    client
        .get_transaction_count(client.address(), None)
        .await
        .unwrap()
}

#[tokio::main]
pub async fn main() -> anyhow::Result<()> {
    let command = Command::parse();
    dotenv::dotenv().context("couldn't load .env file")?;
    let env: Env = envy::from_env().context("couldn't parse environment")?;
    let client = make_client(&env).await?;

    match command {
        Command::DeployBridge { root } => deploy_bridge(client, root).await?,
        Command::DeployERC20 {
            root,
            initial_supply,
        } => deploy_erc20(client, root, initial_supply).await?,
        Command::Address => address(env).await?,
        Command::SecretHex => secret_hex(env).await?,
        Command::WatchEvents { contract } => watch_events(client, contract).await?,
        Command::BridgeIn {
            bridge,
            token,
            amount,
            destination_chain,
            destination_address,
        } => {
            bridge_in(
                client,
                bridge,
                token,
                amount,
                destination_chain,
                destination_address,
            )
            .await?
        }
    }

    Ok(())
}

async fn deploy_bridge(client: Arc<EthClient>, root: PathBuf) -> anyhow::Result<()> {
    let compiled = Solc::default()
        .compile_source(root)
        .context("compilation failed")?;

    if compiled.has_error() {
        for error in compiled.errors {
            eprintln!("{error}");
        }

        return Err(anyhow!("compilation failed"));
    }

    let bridge_contract = compiled
        .find("Bridge")
        .context("couldn't find Bridge contract")?;

    let bridge_factory = ContractFactory::new(
        bridge_contract.abi.unwrap().clone(),
        bridge_contract.bytecode().unwrap().clone(),
        client.clone(),
    );

    let nonce = get_nonce(&client).await;

    let mut deployer = bridge_factory
        .deploy(())
        .context("couldn't prepare deploy")?
        .confirmations(0usize);

    deployer.tx.set_nonce(nonce);

    let bridge_contract = deployer.send().await.context("couldn't deploy contract")?;

    let address = bridge_contract.address();
    println!("bridge contract deployed: {address:x}");

    Ok(())
}

async fn deploy_erc20(
    client: Arc<EthClient>,
    root: PathBuf,
    initial_supply: String,
) -> anyhow::Result<()> {
    let compiled = Solc::default()
        .compile_source(root)
        .context("compilation failed")?;

    if compiled.has_error() {
        for error in compiled.errors {
            eprintln!("{error}");
        }

        return Err(anyhow!("compilation failed"));
    }

    let token_contract = compiled
        .find("TestToken")
        .context("couldn't find TestToken contract")?;

    let token_factory = ContractFactory::new(
        token_contract.abi.unwrap().clone(),
        token_contract.bytecode().unwrap().clone(),
        client.clone(),
    );

    let initial_supply =
        U256::from_dec_str(&initial_supply).context("couldn't parse initial supply")?;

    let nonce = get_nonce(&client).await;

    let mut deployer = token_factory
        .deploy(initial_supply)
        .context("couldn't prepare deploy")?
        .confirmations(0usize);

    deployer.tx.set_nonce(nonce);

    let token_contract = deployer.send().await.context("couldn't deploy contract")?;

    let address = token_contract.address();
    println!("token contract deployed: {address:x}");

    Ok(())
}

async fn address(env: Env) -> anyhow::Result<()> {
    let secret = env.secret()?;
    let address = secret_key_to_address(&secret.into());

    println!("{address:x}");

    Ok(())
}

async fn secret_hex(env: Env) -> anyhow::Result<()> {
    let secret = env.secret()?;
    let secret = secret.as_scalar_core();
    println!("{secret:x}");

    Ok(())
}

async fn watch_events(client: Arc<EthClient>, contract: String) -> anyhow::Result<()> {
    let address: H160 = contract.parse().context("invalid adddress")?;
    // let contract = ethereum_util::abi::BridgeContract::new(address, client.clone());

    // async fn __ty_hack<'a, M: Middleware>(
    //     event: &'a Event<'a, M, BridgeContractEvents>,
    // ) -> EventStream<'a, FilterWatcher<'a, M::Provider, Log>, BridgeContractEvents, ContractError<M>>
    // {
    //     let events_stream = event.stream().await.expect("could not watch event stream");
    //     events_stream
    // }

    // let events = contract.events();
    // let mut stream = __ty_hack(&events).await;

    // while let Some(event) = stream.next().await {
    //     println!("{event:?}");
    // }

    let filter = Filter::new().address(address);
    let mut watcher = client
        .watch(&filter)
        .await
        .context("failed to get filter watcher")?;

    while let Some(log) = watcher.next().await {
        let event = BridgeContractEvents::decode_log(&RawLog {
            topics: log.topics.clone(),
            data: log.data.to_vec(),
        })
        .expect("invalid event");

        let tx_hash = if let Some(hash) = log.transaction_hash {
            hash.to_string()
        } else {
            "(no tx hash)".into()
        };
        println!(
            "log_index: {:?} tx_log_index: {:?} tx_index: {:?}",
            log.log_index, log.transaction_log_index, log.transaction_index
        );
        println!("tx: {tx_hash} ev: {event:?}");
    }

    Ok(())
}

async fn bridge_in(
    client: Arc<EthClient>,
    bridge: String,
    token: String,
    amount: String,
    destination_chain: String,
    destination_address: String,
) -> anyhow::Result<()> {
    let bridge_address: H160 = bridge.parse().context("invalid bridge adddress")?;
    let token_address: H160 = token.parse().context("invalid token adddress")?;

    let amount = U256::from_dec_str(&amount).context("couldn't parse amount")?;

    let bridge_contract = ethereum_util::abi::BridgeContract::new(bridge_address, client.clone());
    let token_contract = ethereum_util::abi::ERC20Contract::new(token_address, client.clone());

    token_contract
        .approve(bridge_address, amount)
        .send()
        .await
        .context("approval failed")?
        .confirmations(1)
        .await
        .context("waiting for confirm of approval tx failed")?;

    bridge_contract
        .bridge_in(
            token_address,
            client.address(),
            amount,
            destination_chain,
            destination_address,
        )
        .gas(100_000)
        .send()
        .await
        .context("bridge in failed")?
        .confirmations(1)
        .await
        .context("waiting for confirm of bridge in tx failed")?;

    Ok(())
}
