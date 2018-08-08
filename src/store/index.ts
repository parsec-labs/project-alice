import { observable, action, toJS, reaction } from "mobx";
import TransactionModel from "./Transaction";
import getWeb3 from "../getWeb3";
import * as memoize from "mem";
import BigNumber from "bignumber.js";
import { Transaction, TransactionReceipt, Contract } from "web3/types";
import { GENESIS_BLOCK } from "../config";

const range = (from: number, to: number) => Array.from(new Array(to - from), (_, i) => i + from);

const txOwnFilter = (address: string) => (transaction: Transaction) => {
    return String(transaction.from).toLowerCase() === address.toLowerCase() ||
        String(transaction.to).toLowerCase() === address.toLowerCase();
};

const readBlocksInBatch = (fromBlock: number, toBlock: number): Promise<Array<any>> => {
    const web3 = getWeb3();
    return new Promise((resolve) => {
        const batch = new web3.eth.BatchRequest();
        const result = [];
        let received = 0;
        const callback = i => (err, block) => {
            result[i - fromBlock] = block;
            if (received === toBlock - fromBlock) {
                resolve(result);
            }
            received += 1;
        };
        for (let i = fromBlock; i <= toBlock; i += 1) {
            batch.add(web3.eth.getBlock.request(i, true, callback(i)));
        }
        batch.execute();
    });
};

// request once for all stores
const getBlocksRange = memoize((fromBlock: number, toBlock: number) => {
    if (false) { // parsec node doesn't support batches
        const web3 = getWeb3();
        return Promise.all(range(fromBlock, toBlock + 1)
            .map(i => web3.eth.getBlock(i, true)));
    }
    return readBlocksInBatch(fromBlock, toBlock);
});

const getTransactions = async (address: string, fromBlock: number, toBlock: number) => {
    if (fromBlock === toBlock) {
        return [];
    }

    // fromBlock = Math.max(fromBlock, toBlock - 1000); // limit blocks number to 1000

    const blocks = await getBlocksRange(fromBlock, toBlock);

    const transactions = (
        blocks
            .filter(b => b && b.transactions)
            .reduce((txs, block) => txs.concat(block.transactions.filter(txOwnFilter(address))), [])
    );
    return transactions;
};

const loadStore = (address) => {
    const store = null; // localStorage.getItem(`psc2_store_${address.substr(2, 6)}`);
    return store && JSON.parse(store) || {
        fromBlock: GENESIS_BLOCK,
        balance: 0,
        loading: true
    };
};

class Store {
    @observable transactions = [];
    @observable fromBlock: number;
    @observable notifications: number = 0;
    @observable address: string;
    @observable privKey: string;
    @observable balance: number;
    @observable balances: Array<number>;
    @observable loading: boolean;

    color: number;
    token: Contract;
    tcs: Array<Contract> = [];

    // ToDo: pass privKey only. Address can be derrived from private key
    constructor({address, key, token, tcs, color}:
        {address: string, key: string, token: Contract, tcs: Array<Contract>, color: number}) {
        this.address = address;
        this.privKey = key;
        this.token = token;
        this.color = color;
        this.tcs = tcs;

        try {
            const { transactions, ...store }: any = loadStore(this.address);

            Object.assign(this, store);

            if (transactions) {
                this.transactions = transactions.map((transaction: TransactionReceipt) => {
                    return new TransactionModel(transaction);
                });
            }

            this.getBalance(address);
            this.getBalances(address);

            this.load(address, this.fromBlock);

        } catch (error) {
            console.error(error.message);
        }
    }

    @action
    add = (transaction: any) => {
        const index = this.transactions.findIndex(({transactionHash}: any) => {
            return transactionHash === transaction.hash;
        });

        if (index === -1) {
            const tx = new TransactionModel(Object.assign({}, transaction, {
                transactionHash: transaction.hash
            }));
            this.transactions.push(tx);
        } else {
            this.transactions[index].update(transaction);
        }

        this.loading = false;
        this.notifications = this.notifications + 1;
        this.save();
    }

    @action
    getBalance = async (address) => {
        try {
            const balance = await this.token.methods.balanceOf(address).call();
            this.balance = new BigNumber(balance).toNumber();
        } catch (err) {
            console.error(err.message);
        }
    }

    @action
    getBalances = async (address) => {
        try {

            const balances = await Promise.all(this.tcs.map( (tc) => {
                return tc.methods.balanceOf(address).call();
            } ));

            this.balances = balances.map(b => new BigNumber(b).toNumber());
        } catch (err) {
            console.error(err.message);
        }
    }

    @action
    load = async (address: string, fromBlock: number = GENESIS_BLOCK) => {
        const web3 = getWeb3();
        // start from 0 for plasma chain
        // start from blockNumber - n for ethereum
        const blockNumber = await web3.eth.getBlockNumber();

        try {
            const transactions = await getTransactions(address, fromBlock, blockNumber);

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
    }

    save = () => {
        // localStorage.setItem(`psc2_store_${this.address.substr(2, 6)}`, JSON.stringify({
        //     transactions: toJS(this.transactions),
        //     fromBlock: this.fromBlock,
        //     balance: this.balance
        // }));
    }
}

export default Store;