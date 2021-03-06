import { observable, action } from 'mobx';
import * as memoize from 'mem';
import TransactionModel from './Transaction';
import getWeb3 from '../getWeb3';
import { Transaction, TransactionReceipt, Contract, Block } from 'web3/types';
import { GENESIS_BLOCK } from '../config';

const range = (from: number, to: number) =>
  Array.from(new Array(to - from), (_, i) => i + from);

const txOwnFilter = (address: string) => (transaction: Transaction) => {
  return (
    String(transaction.from).toLowerCase() === address.toLowerCase() ||
    String(transaction.to).toLowerCase() === address.toLowerCase()
  );
};

const readBlocksInBatch = (
  fromBlock: number,
  toBlock: number
): Promise<Array<any>> => {
  const web3 = getWeb3();
  return new Promise(resolve => {
    const batch = new web3.eth.BatchRequest();
    const result = [] as Block[];
    let received = 0;
    const callback = (i: number) => (err: any, block: Block) => {
      result[i - fromBlock] = block;
      if (received === toBlock - fromBlock) {
        resolve(result);
      }
      received += 1;
    };
    for (let i = fromBlock; i <= toBlock; i += 1) {
      batch.add((web3.eth.getBlock as any).request(i, true, callback(i)));
    }
    batch.execute();
  });
};

// request once for all stores
const getBlocksRange = memoize(
  (fromBlock: number, toBlock: number): Promise<Block[]> => {
    if (false) {
      // leap node doesn't support batches
      const web3 = getWeb3();
      return Promise.all(
        range(fromBlock, toBlock + 1).map(i => web3.eth.getBlock(i, true))
      );
    }
    return readBlocksInBatch(fromBlock, toBlock);
  }
);

const getTransactions = async (
  address: string,
  fromBlock: number,
  toBlock: number
) => {
  if (fromBlock === toBlock) {
    return [];
  }

  const blocks = await getBlocksRange(fromBlock, toBlock);
  const transactions = blocks
    .filter(b => b && b.transactions)
    .reduce(
      (txs, block) =>
        txs.concat(block.transactions.filter(txOwnFilter(address))),
      [] as Transaction[]
    );
  return transactions;
};

const loadStore = (address: string) => {
  const store = null; // localStorage.getItem(`psc2_store_${address.substr(2, 6)}`);
  return (
    (store && JSON.parse(store)) || {
      fromBlock: GENESIS_BLOCK,
      balance: 0,
      loading: true,
    }
  );
};

class Store {
  @observable
  transactions: TransactionModel[] = [];
  @observable
  fromBlock: number;
  @observable
  notifications: number = 0;
  @observable
  address: string;
  @observable
  privKey: string;
  @observable
  balance: number;
  @observable
  balances: Array<number>;
  @observable
  loading: boolean;

  color: number;
  token?: Contract;
  tcs?: Array<Contract> = [];

  // ToDo: pass privKey only. Address can be derrived from private key
  constructor({
    address,
    key,
    token,
    tcs,
    color,
  }: {
    address: string;
    key: string;
    token?: Contract;
    tcs?: Array<Contract>;
    color: number;
  }) {
    this.address = address;
    this.privKey = key;
    this.token = token;
    this.color = color;
    this.tcs = tcs;

    try {
      const { transactions, ...store }: any = loadStore(this.address);

      Object.assign(this, store);

      if (transactions) {
        this.transactions = transactions.map(
          (transaction: TransactionReceipt) => {
            return new TransactionModel(transaction);
          }
        );
      }

      // this.getBalance(address);
      // this.getBalances(address);

      // this.load(address, this.fromBlock);
    } catch (error) {
      console.error(error.message);
    }
  }

  @action
  setTokens(tokens: Array<Contract>) {
    this.tcs = tokens;
    this.token = this.tcs[0];

    this.getBalance(this.address);
    this.getBalances(this.address);
    this.load(this.address, this.fromBlock);
  }

  @action
  add = (transaction: any) => {
    const index = this.transactions.findIndex(({ transactionHash }: any) => {
      return transactionHash === transaction.hash;
    });

    if (index === -1) {
      const tx = new TransactionModel(
        Object.assign({}, transaction, {
          transactionHash: transaction.hash,
        })
      );
      this.transactions.push(tx);
    } else {
      this.transactions[index].update(transaction);
    }

    this.loading = false;
    this.notifications = this.notifications + 1;
    this.save();
  };

  @action
  getBalance = async (address: string) => {
    try {
      if (this.token) {
        const balance = await this.token.methods.balanceOf(address).call();
        this.balance = Number(balance);
      }
    } catch (err) {
      console.error(err.message);
    }
  };

  @action
  getBalances = async (address: string) => {
    try {
      if (this.tcs) {
        const balances = await Promise.all(
          this.tcs.map(tc => {
            return tc.methods.balanceOf(address).call();
          })
        );

        this.balances = balances.map(b => Number(b));
      }
    } catch (err) {
      console.error(err.message);
    }
  };

  @action
  load = async (address: string, fromBlock: number = GENESIS_BLOCK) => {
    const web3 = getWeb3();
    // start from 0 for plasma chain
    // start from blockNumber - n for ethereum
    const blockNumber = await web3.eth.getBlockNumber();

    try {
      const transactions = await getTransactions(
        address,
        fromBlock,
        blockNumber
      );

      if (transactions.length > 0) {
        transactions.map(this.add.bind(this));
        this.getBalance(address);
        this.getBalances(address);
      }
      this.fromBlock = blockNumber;

      this.save();

      setTimeout(() => {
        this.load(address, this.fromBlock);
      }, 5000);
    } catch (error) {
      console.error(error.message);
      setTimeout(() => {
        this.load(address, fromBlock);
      }, 5000);
    }
  };

  save = () => {
    // localStorage.setItem(`psc2_store_${this.address.substr(2, 6)}`, JSON.stringify({
    //     transactions: toJS(this.transactions),
    //     fromBlock: this.fromBlock,
    //     balance: this.balance
    // }));
  };
}

export default Store;
