/*
 Initialize web3 instances of token, hub and exchange contracts.
 Load all relevant accounts, balances, orders.
 NOTE web3 globally available as linked in home.html
 */
// Exchange, token, hub contract addresses
const exchangeAddress = '0xd9206f77dd8e6557744feb30a12e68d8a09bb043'
const tokenAddress = '0x87dec673238cd9fe9bc1479c21f9f8165bc3879b'
const hubAddress = '0x21808e0d63d2fd3c5579a4425d3e9314ae47c6b9'

$(window).ready(() => {
  // Approved tokens to trade on the exchange, mapping symbol <> address
  window.approvedTokens = {
    'ETH': '0x0000000000000000000000000000000000000000',
    'BLG': tokenAddress
  }

  window.tokenAddressToSymbol = {
    '0x0000000000000000000000000000000000000000': 'ETH',
    '0x87dec673238cd9fe9bc1479c21f9f8165bc3879b': 'BLG'
  }

  // Some race conditiion where metamask is slow to be injected wait then connect.
  if (!window.web3) {
    setTimeout(() => {
      // If still no web3 then alert, metamask likely not installed
      if (!window.web3) {
        alert('Please install Metamask to use this application!\n https://chrome.google.com/webstore/detail/metamask/nkbihfbeogaeaoehlefnkodbefgpgknn?hl=en')
      } else {
        loadWeb3()
      }
    }, 500)

  // Metamask is present than connect to it
  } else {
    loadWeb3()
  }
})

function loadWeb3() {
  const web3 = new Web3(window.web3.currentProvider) // Metamask

  if (web3.isConnected()) {
    // Create instance of the exchange token and hub
    window.token = web3.eth.contract(tokenJSON.abi).at(tokenAddress)
    window.hub = web3.eth.contract(hubJSON.abi).at(hubAddress)
    window.exchange = web3.eth.contract(exchangeJSON.abi).at(exchangeAddress)
    window.defaultAccount = web3.eth.accounts[0]

    // Create relevant listeners for all contracts
    initTokenListeners()
    initExchangeListeners()

    // Load balances for the user as well as the order book contents
    updateETHBalance(defaultAccount)
    updateTokenBalance(defaultAccount)
    loadOrderBook()
  }
}

/**
 * Create listeners for the exchange contract.
 */
function initExchangeListeners() {
  // Listen for all exchange events
  exchange.allEvents({ from: 'latest', to: 'latest' })
  .watch((error, res) => {
    if (error) console.log(error)

    console.log(res)

    if (res.event === 'logOrderSubmitted') {
      // Update balances - eth may have been transferred to exchange
      updateETHBalance(defaultAccount)
      const { maker, offerToken, offerAmount, wantToken, wantAmount } = res.args

      // Append new order to order book table
      appendOrder(maker, offerToken, offerAmount, wantToken, wantAmount)
      openTransactionSuccessModal('Order Submitted.', res.transactionHash)

    } else if (res.event === 'logOrderExecuted') {
      openTransactionSuccessModal('Order Executed.', res.transactionHash)

      // Update balances
      updateETHBalance(defaultAccount)
      updateTokenBalance(defaultAccount)

      // Remove row if order executed
      const id = '#' + res.args.offerToken + res.args.offerAmount + res.args.wantToken + res.args.wantAmount
      $(id).remove()

    } else if (res.event === 'LogErrorString') {
      updateETHBalance(defaultAccount)
      alert('Error! \n' + res.args.errorString)
    }
  })
}

/**
 * Create listeners for the token.
 */
function initTokenListeners() {
  // Tokens minted. Will be the result of submitting a resource to the hub.
  token.LogTokensMinted({ from: 'latest', to: 'latest' })
  .watch((err, res) => {
    if (err) {
      console.log(err)
    } else {
      console.log(res)
      openTransactionSuccessModal('Tokens minted.', res.transactionHash)

      // If tokens minted to user update their balance
      if (res.args.to == defaultAccount) {
        updateETHBalance(defaultAccount)
        updateTokenBalance(defaultAccount)
      }
    }
  })

   // Error event
   token.LogErrorString({ from: 'latest', to: 'latest' })
   .watch((err, res) => {
     if (err) {
       console.log(err)
     } else {
       updateETHBalance(defaultAccount)
       alert('Error! \n' + res.args.errorString)
     }
   })
 }

 /**
  * Update the the default account's ether balance.
  * @param  {String} user The EOA address.
  */
 function updateETHBalance(user) {
   web3.eth.getBalance(user, (err, balance) => {
     if (err) {
       console.error(err)
     } else {
       $('#etherBalance').text(balance.toNumber() / 10**18 + ' ETH') // convert wei to eth
     }
   })
 }

 /**
  * Update the default account's token balance.
  * @param  {String} user The EOA address.
  */
 function updateTokenBalance(user) {
   // Get the balance of the user
   token.balanceOf(user, (err, balance) => {
      // Get the sybmol of the token
      token.symbol((err, symbol) => {
        $('#blgBalance').text(balance.toNumber() + ' ' + symbol)
      })
   })
 }

 /**
  * Load the contents of the order book.
  * TODO Get the order book from events! Remove the storage array.
  */
 function loadOrderBook() {
   exchange.getOrderBookIds.call((error, ids) => {
     // Get order data and load for each returned id
     for (let i = 0; i < ids.length; i++) {
       exchange.orderBook_.call(ids[i], (err, order) => {
         // NOTE if order added, executed and exact same order added again
         // it will appear twice in the order book. FIXME! Create unique ids, nonce.
         // If the order is not filled then append
         if (!order[5]) {
           appendOrder(order[0], order[1], order[2], order[3], order[4])
         }
       })
     }
   })
 }

/*
 Utils
 */

/**
 * Append a new order to the order book table.
 * @param  {String} maker  The address of the user who created the order.
 * @param  {String} offerToken  The address of the token contract offered.
 * @param  {Number} offerAmount The amount of tokens offered.
 * @param  {String} wantToken  The address of the token contract wanted.
 * @param  {Number} wantAmount The amount of tokens wanted.
 * when offering ether to transfer the value to the exchange to broker the trade.
 */
function appendOrder(maker, offerToken, offerAmount, wantToken, wantAmount) {
   const offerSymbol = tokenAddressToSymbol[offerToken]
   const wantSymbol = tokenAddressToSymbol[wantToken]
   let offerAmountAdjusted = offerAmount
   let wantAmountAdjusted = wantAmount

   // Convert eth amount from wei
   if (offerSymbol === 'ETH') {
     offerAmountAdjusted = offerAmount / 10**18
   } else if (wantSymbol === 'ETH') {
     wantAmountAdjusted = wantAmount / 10**18
   }

   $('#orderBook').append(
     '<tr id='
       // Sufficient ID for now as only one order can exist with these params at this time.
       + offerToken + offerAmount + wantToken + wantAmount
       +' ><td>'
       + offerSymbol + '</td><td>'
       + offerAmountAdjusted + '</td><td>'
       + wantSymbol + '</td><td>'
       + wantAmountAdjusted + '</td><td>'
       + maker
     + '</td><</tr>'
   )
 }

/**
* Open the successful transaction modal
* @param  {String} tx The transaction hash.
*/
function openTransactionSuccessModal(msg, tx) {
 const href = 'https://kovan.etherscan.io/tx/' + tx
 $('#txHash').empty()
 $('#txHash').append('<p>'+ msg +'</p>')
 $('#txHash').append('</br><p>Here is your transaction hash:</p>')
 $('#txHash').append('<a href='+ href +'>'+ tx +'</a>')
 $('#successModal').modal('show')
}

const exchangeJSON = {
  "contract_name": "Exchange",
  "abi": [
    {
      "constant": true,
      "inputs": [],
      "name": "getOrderBookIds",
      "outputs": [
        {
          "name": "",
          "type": "bytes32[]"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [
        {
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "orderIds_",
      "outputs": [
        {
          "name": "",
          "type": "bytes32"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [
        {
          "name": "",
          "type": "bytes32"
        }
      ],
      "name": "orderBook_",
      "outputs": [
        {
          "name": "maker",
          "type": "address"
        },
        {
          "name": "offerToken",
          "type": "address"
        },
        {
          "name": "offerAmount",
          "type": "uint256"
        },
        {
          "name": "wantToken",
          "type": "address"
        },
        {
          "name": "wantAmount",
          "type": "uint256"
        },
        {
          "name": "filled",
          "type": "bool"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": false,
      "inputs": [
        {
          "name": "_offerToken",
          "type": "address"
        },
        {
          "name": "_offerAmount",
          "type": "uint256"
        },
        {
          "name": "_wantToken",
          "type": "address"
        },
        {
          "name": "_wantAmount",
          "type": "uint256"
        }
      ],
      "name": "submitOrder",
      "outputs": [
        {
          "name": "",
          "type": "bool"
        }
      ],
      "payable": true,
      "type": "function"
    },
    {
      "payable": true,
      "type": "fallback"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "name": "maker",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "offerToken",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "offerAmount",
          "type": "uint256"
        },
        {
          "indexed": false,
          "name": "wantToken",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "wantAmount",
          "type": "uint256"
        }
      ],
      "name": "logOrderSubmitted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "name": "maker",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "taker",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "offerToken",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "offerAmount",
          "type": "uint256"
        },
        {
          "indexed": false,
          "name": "wantToken",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "wantAmount",
          "type": "uint256"
        }
      ],
      "name": "logOrderExecuted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "name": "errorString",
          "type": "string"
        }
      ],
      "name": "LogErrorString",
      "type": "event"
    }
  ],
  "unlinked_binary": "0x6060604052341561000f57600080fd5b5b610a248061001f6000396000f300606060405236156100465763ffffffff60e060020a6000350416631be09130811461004a5780633f5f18bc146100b1578063708a02c9146100d95780638c946c2614610134575b5b5b005b341561005557600080fd5b61005d610169565b60405160208082528190810183818151815260200191508051906020019060200280838360005b8381101561009d5780820151818401525b602001610084565b505050509050019250505060405180910390f35b34156100bc57600080fd5b6100c76004356101c9565b60405190815260200160405180910390f35b34156100e457600080fd5b6100ef6004356101ec565b604051600160a060020a0396871681529486166020860152604080860194909452919094166060840152608083019390935291151560a082015260c001905180910390f35b610155600160a060020a036004358116906024359060443516606435610233565b604051901515815260200160405180910390f35b610171610966565b60018054806020026020016040519081016040528092919081815260200182805480156101be57602002820191906000526020600020905b815481526001909101906020018083116101a9575b505050505090505b90565b60018054829081106101d757fe5b906000526020600020900160005b5054905081565b600060208190529081526040902080546001820154600283015460038401546004850154600590950154600160a060020a0394851695938516949293919092169160ff1686565b6000808080861161024357600080fd5b6000841161025057600080fd5b600160a060020a038716151561027d57600160a060020a033016318690101561027857600080fd5b6102fd565b8587600160a060020a03166370a082313360006040516020015260405160e060020a63ffffffff8416028152600160a060020a039091166004820152602401602060405180830381600087803b15156102d557600080fd5b6102c65a03f115156102e657600080fd5b50505060405180519050101515156102fd57600080fd5b5b84848888604051606060020a600160a060020a03958616810282526014820194909452919093169091026034820152604881019190915260680160405190819003902060008181526020819052604090206004015490925015801590610376575060008281526020819052604090206005015460ff16155b1561038b57610384826105ed565b92506105e2565b86868686604051606060020a600160a060020a03958616810282526014820194909452919093169091026034820152604881019190915260680160405190819003902060008181526020819052604090206004015490925015801590610403575060008281526020819052604090206005015460ff16155b1561047357610384606060405190810160405280603981526020017f4964656e746963616c206f7264657220697320616c72656164792061637469768152602001603860020a78652c2045786368616e67652e7375626d69744f726465722829028152506108c2565b92506105e2565b600180548082016104848382610978565b916000526020600020900160005b508390555060c06040519081016040908152600160a060020a0333811683528981166020808501919091528284018a9052908816606084015260808301879052600060a08401819052858152908190522081518154600160a060020a031916600160a060020a03919091161781556020820151600182018054600160a060020a031916600160a060020a0392909216919091179055604082015181600201556060820151600382018054600160a060020a031916600160a060020a03929092169190911790556080820151816004015560a0820151600591909101805460ff1916911515919091179055507f2488a98af2c19a2f8be4fe1dfdd5a86048f4e5695c6d230f027aa9de0dd7af0d3388888888604051600160a060020a039586168152938516602085015260408085019390935293166060830152608082019290925260a001905180910390a1600192505b5b5050949350505050565b60006105f76109a2565b600083815260208190526040908190209060c0905190810160409081528254600160a060020a039081168352600184015481166020840190815260028501549284019290925260038401541660608301526004830154608083015260059092015460ff16151560a0820152915060009051600160a060020a031614156107425733600160a060020a03166108fc82604001519081150290604051600060405180830381858888f1935050505015156106ae57600080fd5b8060600151600160a060020a03166323b872dd338351846080015160006040516020015260405160e060020a63ffffffff8616028152600160a060020a0393841660048201529190921660248201526044810191909152606401602060405180830381600087803b151561072157600080fd5b6102c65a03f1151561073257600080fd5b505050604051805190505061081f565b60006060820151600160a060020a0316141561081f578051600160a060020a03166108fc82608001519081150290604051600060405180830381858888f19350505050151561079057600080fd5b8060200151600160a060020a03166323b872dd825133846040015160006040516020015260405160e060020a63ffffffff8616028152600160a060020a0393841660048201529190921660248201526044810191909152606401602060405180830381600087803b151561080357600080fd5b6102c65a03f1151561081457600080fd5b505050604051805150505b5b6000838152602081905260409020600501805460ff191660011790557f9a1421e25c7471f70dc672f22aea188ba8d3ab35386ac1296fcb5e1c8dcbc1a38151338360200151846040015185606001518660800151604051600160a060020a03968716815294861660208601529285166040808601919091526060850192909252909316608083015260a082015260c001905180910390a1600191505b50919050565b60007f551303dd5f39cbfe6daba6b3e27754b8a7d72f519756a2cde2b92c2bbde159a78260405160208082528190810183818151815260200191508051906020019080838360005b838110156109235780820151818401525b60200161090a565b50505050905090810190601f1680156109505780820380516001836020036101000a031916815260200191505b509250505060405180910390a15060005b919050565b60206040519081016040526000815290565b81548183558181151161099c5760008381526020902061099c9181019083016109d7565b5b505050565b60c06040519081016040908152600080835260208301819052908201819052606082018190526080820181905260a082015290565b6101c691905b808211156109f157600081556001016109dd565b5090565b905600a165627a7a72305820d2cae7fc1d5b185392091796fd809601ee4b28717f0b8ce5ea978f67b424eb520029",
  "networks": {
    "1507665091422": {
      "events": {
        "0x2488a98af2c19a2f8be4fe1dfdd5a86048f4e5695c6d230f027aa9de0dd7af0d": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "maker",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "offerToken",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "offerAmount",
              "type": "uint256"
            },
            {
              "indexed": false,
              "name": "wantToken",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "wantAmount",
              "type": "uint256"
            }
          ],
          "name": "logOrderSubmitted",
          "type": "event"
        },
        "0x9a1421e25c7471f70dc672f22aea188ba8d3ab35386ac1296fcb5e1c8dcbc1a3": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "maker",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "taker",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "offerToken",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "offerAmount",
              "type": "uint256"
            },
            {
              "indexed": false,
              "name": "wantToken",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "wantAmount",
              "type": "uint256"
            }
          ],
          "name": "logOrderExecuted",
          "type": "event"
        },
        "0x551303dd5f39cbfe6daba6b3e27754b8a7d72f519756a2cde2b92c2bbde159a7": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "errorString",
              "type": "string"
            }
          ],
          "name": "LogErrorString",
          "type": "event"
        }
      },
      "links": {},
      "address": "0xd9206f77dd8e6557744feb30a12e68d8a09bb043",
      "updated_at": 1507672058414
    }
  },
  "schema_version": "0.0.5",
  "updated_at": 1507672058414
}

const tokenJSON = {
  "contract_name": "Token",
  "abi": [
    {
      "constant": true,
      "inputs": [],
      "name": "name",
      "outputs": [
        {
          "name": "",
          "type": "string"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": false,
      "inputs": [
        {
          "name": "_spender",
          "type": "address"
        },
        {
          "name": "_amount",
          "type": "uint256"
        }
      ],
      "name": "approve",
      "outputs": [
        {
          "name": "",
          "type": "bool"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "totalSupply",
      "outputs": [
        {
          "name": "",
          "type": "uint256"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": false,
      "inputs": [
        {
          "name": "_from",
          "type": "address"
        },
        {
          "name": "_to",
          "type": "address"
        },
        {
          "name": "_amount",
          "type": "uint256"
        }
      ],
      "name": "transferFrom",
      "outputs": [
        {
          "name": "",
          "type": "bool"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [
        {
          "name": "",
          "type": "address"
        },
        {
          "name": "",
          "type": "address"
        }
      ],
      "name": "allowed_",
      "outputs": [
        {
          "name": "",
          "type": "uint256"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "decimals",
      "outputs": [
        {
          "name": "",
          "type": "uint256"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": false,
      "inputs": [
        {
          "name": "_hub",
          "type": "address"
        }
      ],
      "name": "setHub",
      "outputs": [
        {
          "name": "",
          "type": "bool"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "totalSupply_",
      "outputs": [
        {
          "name": "",
          "type": "uint256"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": false,
      "inputs": [
        {
          "name": "_to",
          "type": "address"
        },
        {
          "name": "_value",
          "type": "uint256"
        }
      ],
      "name": "mint",
      "outputs": [
        {
          "name": "",
          "type": "bool"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [
        {
          "name": "",
          "type": "address"
        }
      ],
      "name": "balances_",
      "outputs": [
        {
          "name": "",
          "type": "uint256"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [
        {
          "name": "_owner",
          "type": "address"
        }
      ],
      "name": "balanceOf",
      "outputs": [
        {
          "name": "",
          "type": "uint256"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "hub_",
      "outputs": [
        {
          "name": "",
          "type": "address"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "symbol",
      "outputs": [
        {
          "name": "",
          "type": "string"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": false,
      "inputs": [
        {
          "name": "_to",
          "type": "address"
        },
        {
          "name": "_value",
          "type": "uint256"
        }
      ],
      "name": "transfer",
      "outputs": [
        {
          "name": "",
          "type": "bool"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [
        {
          "name": "_owner",
          "type": "address"
        },
        {
          "name": "_spender",
          "type": "address"
        }
      ],
      "name": "allowance",
      "outputs": [
        {
          "name": "remaining",
          "type": "uint256"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "owner_",
      "outputs": [
        {
          "name": "",
          "type": "address"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "inputs": [],
      "payable": false,
      "type": "constructor"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "name": "_to",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "to",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "value",
          "type": "uint256"
        },
        {
          "indexed": false,
          "name": "totalSupply",
          "type": "uint256"
        }
      ],
      "name": "LogTokensMinted",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "name": "errorString",
          "type": "string"
        }
      ],
      "name": "LogErrorString",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "name": "_from",
          "type": "address"
        },
        {
          "indexed": true,
          "name": "_to",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "_value",
          "type": "uint256"
        }
      ],
      "name": "Transfer",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": true,
          "name": "_owner",
          "type": "address"
        },
        {
          "indexed": true,
          "name": "_spender",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "_value",
          "type": "uint256"
        }
      ],
      "name": "Approval",
      "type": "event"
    }
  ],
  "unlinked_binary": "0x6060604052341561000f57600080fd5b5b60038054600160a060020a03191633600160a060020a03161790555b5b610f1d8061003c6000396000f300606060405236156100ca5763ffffffff60e060020a60003504166306fdde0381146100cf578063095ea7b31461015a57806318160ddd1461019057806323b872dd146101b55780632839e16a146101f1578063313ce5671461022857806331962cdc1461024d578063324536eb1461028057806340c10f19146102a55780636ca34ea2146102db57806370a082311461030c5780638ed5520c1461033d57806395d89b411461036c578063a9059cbb146103f7578063dd62ed3e1461042d578063e766307914610464575b600080fd5b34156100da57600080fd5b6100e2610493565b60405160208082528190810183818151815260200191508051906020019080838360005b8381101561011f5780820151818401525b602001610106565b50505050905090810190601f16801561014c5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b341561016557600080fd5b61017c600160a060020a03600435166024356104e2565b604051901515815260200160405180910390f35b341561019b57600080fd5b6101a361063b565b60405190815260200160405180910390f35b34156101c057600080fd5b61017c600160a060020a0360043581169060243516604435610642565b604051901515815260200160405180910390f35b34156101fc57600080fd5b6101a3600160a060020a03600435811690602435166108d6565b60405190815260200160405180910390f35b341561023357600080fd5b6101a36108f3565b60405190815260200160405180910390f35b341561025857600080fd5b61017c600160a060020a03600435166108f8565b604051901515815260200160405180910390f35b341561028b57600080fd5b6101a3610a02565b60405190815260200160405180910390f35b34156102b057600080fd5b61017c600160a060020a0360043516602435610a08565b604051901515815260200160405180910390f35b34156102e657600080fd5b6101a3600160a060020a0360043516610c53565b60405190815260200160405180910390f35b341561031757600080fd5b6101a3600160a060020a0360043516610c65565b60405190815260200160405180910390f35b341561034857600080fd5b610350610c84565b604051600160a060020a03909116815260200160405180910390f35b341561037757600080fd5b6100e2610c93565b60405160208082528190810183818151815260200191508051906020019080838360005b8381101561011f5780820151818401525b602001610106565b50505050905090810190601f16801561014c5780820380516001836020036101000a031916815260200191505b509250505060405180910390f35b341561040257600080fd5b61017c600160a060020a0360043516602435610cb3565b604051901515815260200160405180910390f35b341561043857600080fd5b6101a3600160a060020a0360043581169060243516610de4565b60405190815260200160405180910390f35b341561046f57600080fd5b610350610ded565b604051600160a060020a03909116815260200160405180910390f35b606060405190810160405280602981526020017f426c6f636b636861696e204c6561726e696e672047726f757020436f6d6d756e815260200160b960020a6834ba3c902a37b5b2b70281525081565b600080821161054c57610545606060405190810160405280602f81526020017f43616e206e6f7420617070726f766520616e20616d6f756e74203c3d20302c208152602001608860020a6e546f6b656e2e617070726f7665282902815250610dfc565b9050610635565b600160a060020a0333166000908152600160205260409020548211156105d557610545606060405190810160405280603781526020017f416d6f756e742069732067726561746572207468616e2073656e6465727320628152602001604860020a76616c616e63652c20546f6b656e2e617070726f7665282902815250610dfc565b9050610635565b600160a060020a0333811660009081526002602090815260408083209387168352929052205461060b908363ffffffff610ea016565b600160a060020a033381166000908152600260209081526040808320938816835292905220555060015b92915050565b6000545b90565b60008082116106ae576106a7606060405190810160405280603181526020017f43616e6e6f74207472616e7366657220616d6f756e74203c3d20302c20546f6b8152602001607860020a70656e2e7472616e7366657246726f6d282902815250610dfc565b90506108cf565b600160a060020a03841660009081526001602052604090205482111561073a576106a7606060405190810160405280603e81526020017f46726f6d206163636f756e742068617320616e20696e73756666696369656e7481526020017f2062616c616e63652c20546f6b656e2e7472616e7366657246726f6d28290000815250610dfc565b90506108cf565b600160a060020a03808516600090815260026020908152604080832033909416835292905220548211156107d4576106a7606060405190810160405280603b81526020017f6d73672e73656e6465722068617320696e73756666696369656e7420616c6c6f81526020017f77616e63652c20546f6b656e2e7472616e7366657246726f6d28290000000000815250610dfc565b90506108cf565b600160a060020a0384166000908152600160205260409020546107fd908363ffffffff610eba16565b600160a060020a038086166000908152600160205260408082209390935590851681522054610832908363ffffffff610ea016565b600160a060020a0380851660009081526001602090815260408083209490945587831682526002815283822033909316825291909152205461087a908363ffffffff610eba16565b600160a060020a0380861660008181526002602090815260408083203386168452909152908190209390935590851691600080516020610ed28339815191529085905190815260200160405180910390a35060015b9392505050565b600260209081526000928352604080842090915290825290205481565b601281565b60035460009033600160a060020a039081169116146109665761095f606060405190810160405280602381526020017f6d73672e73656e64657220213d206f776e65722c20546f6b656e2e7365744875815260200160e860020a6262282902815250610dfc565b90506109fd565b600160a060020a03821615156109de5761095f606060405190810160405280603681526020017f496e76616c69642068756220616464726573732c20687562203d3d20616464728152602001605060020a756573732830292c20546f6b656e2e736574487562282902815250610dfc565b90506109fd565b5060048054600160a060020a031916600160a060020a03831617905560015b919050565b60005481565b60035460009033600160a060020a03908116911614801590610a39575060045433600160a060020a03908116911614155b15610a9157610545606060405190810160405280602181526020017f6d73672e73656e64657220213d206f776e65722c20546f6b656e2e6d696e7428815260200160f860020a602902815250610dfc565b9050610635565b60008211610af457610545606060405190810160405280602981526020017f43616e6e6f74206d696e7420612076616c7565206f66203c3d20302c20546f6b815260200160b860020a68656e2e6d696e74282902815250610dfc565b9050610635565b600160a060020a0383161515610b6457610545606060405190810160405280602e81526020017f43616e6e6f74206d696e7420746f6b656e7320746f20616464726573732830298152602001609060020a6d2c20546f6b656e2e6d696e74282902815250610dfc565b9050610635565b600054610b77908363ffffffff610ea016565b6000908155600160a060020a038416815260016020526040902054610ba2908363ffffffff610ea016565b600160a060020a038416600081815260016020526040808220939093555490917f6d69c71ef35e507286bcb03186fe9ebdbf14f6e096ce22d6564de19afd7922b7918691869190518084600160a060020a0316600160a060020a03168152602001838152602001828152602001935050505060405180910390a2600160a060020a0383166000600080516020610ed28339815191528460405190815260200160405180910390a35060015b92915050565b60016020526000908152604090205481565b600160a060020a0381166000908152600160205260409020545b919050565b600454600160a060020a031681565b604080519081016040526003815260e860020a62424c4702602082015281565b600160a060020a03331660009081526001602052604081205482901015610d3657610545606060405190810160405280603081526020017f53656e6465722062616c616e636520697320696e73756666696369656e742c208152602001608060020a6f546f6b656e2e7472616e73666572282902815250610dfc565b9050610635565b600160a060020a033316600090815260016020526040902054610d5f908363ffffffff610eba16565b600160a060020a033381166000908152600160205260408082209390935590851681522054610d94908363ffffffff610ea016565b600160a060020a038085166000818152600160205260409081902093909355913390911690600080516020610ed28339815191529085905190815260200160405180910390a35060015b92915050565b60005b92915050565b600354600160a060020a031681565b60007f551303dd5f39cbfe6daba6b3e27754b8a7d72f519756a2cde2b92c2bbde159a78260405160208082528190810183818151815260200191508051906020019080838360005b83811015610e5d5780820151818401525b602001610e44565b50505050905090810190601f168015610e8a5780820380516001836020036101000a031916815260200191505b509250505060405180910390a15060005b919050565b600082820183811015610eaf57fe5b8091505b5092915050565b600082821115610ec657fe5b508082035b929150505600ddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3efa165627a7a72305820e544a3d462535bfa21371786d87ebe14412104e536fedfe15bc96cdd27e39bea0029",
  "networks": {
    "1507570987209": {
      "events": {
        "0x6d69c71ef35e507286bcb03186fe9ebdbf14f6e096ce22d6564de19afd7922b7": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "name": "_to",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "to",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "value",
              "type": "uint256"
            },
            {
              "indexed": false,
              "name": "totalSupply",
              "type": "uint256"
            }
          ],
          "name": "LogTokensMinted",
          "type": "event"
        },
        "0x551303dd5f39cbfe6daba6b3e27754b8a7d72f519756a2cde2b92c2bbde159a7": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "errorString",
              "type": "string"
            }
          ],
          "name": "LogErrorString",
          "type": "event"
        },
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "name": "_from",
              "type": "address"
            },
            {
              "indexed": true,
              "name": "_to",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "_value",
              "type": "uint256"
            }
          ],
          "name": "Transfer",
          "type": "event"
        },
        "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "name": "_owner",
              "type": "address"
            },
            {
              "indexed": true,
              "name": "_spender",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "_value",
              "type": "uint256"
            }
          ],
          "name": "Approval",
          "type": "event"
        }
      },
      "links": {},
      "address": "0xaecb68dc45dedf4044ced06bae19fc2bc7ff203f",
      "updated_at": 1507587729325
    },
    "1507665091422": {
      "events": {
        "0x6d69c71ef35e507286bcb03186fe9ebdbf14f6e096ce22d6564de19afd7922b7": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "name": "_to",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "to",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "value",
              "type": "uint256"
            },
            {
              "indexed": false,
              "name": "totalSupply",
              "type": "uint256"
            }
          ],
          "name": "LogTokensMinted",
          "type": "event"
        },
        "0x551303dd5f39cbfe6daba6b3e27754b8a7d72f519756a2cde2b92c2bbde159a7": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "errorString",
              "type": "string"
            }
          ],
          "name": "LogErrorString",
          "type": "event"
        },
        "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "name": "_from",
              "type": "address"
            },
            {
              "indexed": true,
              "name": "_to",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "_value",
              "type": "uint256"
            }
          ],
          "name": "Transfer",
          "type": "event"
        },
        "0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": true,
              "name": "_owner",
              "type": "address"
            },
            {
              "indexed": true,
              "name": "_spender",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "_value",
              "type": "uint256"
            }
          ],
          "name": "Approval",
          "type": "event"
        }
      },
      "links": {},
      "address": "0x87dec673238cd9fe9bc1479c21f9f8165bc3879b",
      "updated_at": 1507669773127
    }
  },
  "schema_version": "0.0.5",
  "updated_at": 1507669773127
}

const hubJSON = {
  "contract_name": "Hub",
  "abi": [
    {
      "constant": true,
      "inputs": [
        {
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "users_",
      "outputs": [
        {
          "name": "",
          "type": "address"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [
        {
          "name": "",
          "type": "uint256"
        }
      ],
      "name": "resourceIds_",
      "outputs": [
        {
          "name": "",
          "type": "bytes32"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [
        {
          "name": "",
          "type": "address"
        }
      ],
      "name": "userData_",
      "outputs": [
        {
          "name": "userName_",
          "type": "string"
        },
        {
          "name": "position_",
          "type": "string"
        },
        {
          "name": "location_",
          "type": "string"
        },
        {
          "name": "state_",
          "type": "uint8"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [
        {
          "name": "",
          "type": "bytes32"
        }
      ],
      "name": "resources_",
      "outputs": [
        {
          "name": "url_",
          "type": "string"
        },
        {
          "name": "user_",
          "type": "address"
        },
        {
          "name": "reputation_",
          "type": "uint256"
        },
        {
          "name": "addedAt_",
          "type": "uint256"
        },
        {
          "name": "state_",
          "type": "uint8"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": false,
      "inputs": [
        {
          "name": "_resourceUrl",
          "type": "string"
        }
      ],
      "name": "addResource",
      "outputs": [
        {
          "name": "",
          "type": "bool"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": false,
      "inputs": [
        {
          "name": "_userEOA",
          "type": "address"
        },
        {
          "name": "_userName",
          "type": "string"
        },
        {
          "name": "_position",
          "type": "string"
        },
        {
          "name": "_location",
          "type": "string"
        }
      ],
      "name": "addUser",
      "outputs": [
        {
          "name": "",
          "type": "bool"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "token_",
      "outputs": [
        {
          "name": "",
          "type": "address"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "getAllUsers",
      "outputs": [
        {
          "name": "",
          "type": "address[]"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "constant": true,
      "inputs": [],
      "name": "owner_",
      "outputs": [
        {
          "name": "",
          "type": "address"
        }
      ],
      "payable": false,
      "type": "function"
    },
    {
      "inputs": [
        {
          "name": "_token",
          "type": "address"
        }
      ],
      "payable": false,
      "type": "constructor"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "name": "user",
          "type": "address"
        },
        {
          "indexed": false,
          "name": "resourceUrl",
          "type": "string"
        },
        {
          "indexed": false,
          "name": "blockNumber",
          "type": "uint256"
        }
      ],
      "name": "LogResourceAdded",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "name": "user",
          "type": "address"
        }
      ],
      "name": "LogUserAdded",
      "type": "event"
    },
    {
      "anonymous": false,
      "inputs": [
        {
          "indexed": false,
          "name": "errorString",
          "type": "string"
        }
      ],
      "name": "LogErrorString",
      "type": "event"
    }
  ],
  "unlinked_binary": "0x6060604052341561000f57600080fd5b604051602080610f0b833981016040528080519150505b60018054600160a060020a03808416600160a060020a0319928316179092556000805433909316929091169190911790555b505b610ea2806100696000396000f3006060604052361561007d5763ffffffff60e060020a6000350416630cde7b7f81146100825780630e0056b2146100b457806339fe50d4146100dc5780637f031c7d146102915780638a15309b14610370578063c6361c22146103a2578063d56805e1146103f9578063e2842d7914610428578063e76630791461048f575b600080fd5b341561008d57600080fd5b6100986004356104be565b604051600160a060020a03909116815260200160405180910390f35b34156100bf57600080fd5b6100ca6004356104f0565b60405190815260200160405180910390f35b34156100e757600080fd5b6100fb600160a060020a0360043516610513565b6040518080602001806020018060200185600381111561011757fe5b60ff168152602085820381018552895460026001821615610100026000190190911604908201819052604090910190899080156101955780601f1061016a57610100808354040283529160200191610195565b820191906000526020600020905b81548152906001019060200180831161017857829003601f168201915b50508481038352875460026000196101006001841615020190911604808252602090910190889080156102095780601f106101de57610100808354040283529160200191610209565b820191906000526020600020905b8154815290600101906020018083116101ec57829003601f168201915b505084810382528654600260001961010060018416150201909116048082526020909101908790801561027d5780601f106102525761010080835404028352916020019161027d565b820191906000526020600020905b81548152906001019060200180831161026057829003601f168201915b505097505050505050505060405180910390f35b341561029c57600080fd5b6102a7600435610536565b604051808060200186600160a060020a0316600160a060020a031681526020018581526020018481526020018360038111156102df57fe5b60ff1681526020838203810183528854600260018216156101000260001901909116049082018190526040909101908890801561035d5780601f106103325761010080835404028352916020019161035d565b820191906000526020600020905b81548152906001019060200180831161034057829003601f168201915b5050965050505050505060405180910390f35b341561037b57600080fd5b61038e600480356024810191013561056e565b604051901515815260200160405180910390f35b34156103ad57600080fd5b61038e60048035600160a060020a03169060248035808201929081013591604435808201929081013591606435908101910135610961565b604051901515815260200160405180910390f35b341561040457600080fd5b610098610c24565b604051600160a060020a03909116815260200160405180910390f35b341561043357600080fd5b61043b610c33565b60405160208082528190810183818151815260200191508051906020019060200280838360005b8381101561047b5780820151818401525b602001610462565b505050509050019250505060405180910390f35b341561049a57600080fd5b610098610c9c565b604051600160a060020a03909116815260200160405180910390f35b60048054829081106104cc57fe5b906000526020600020900160005b915054906101000a9004600160a060020a031681565b60028054829081106104fe57fe5b906000526020600020900160005b5054905081565b600560205260009081526040902060038101546001820190600283019060ff1684565b6003602081905260009182526040909120600181015460028201549282015460048301549293600160a060020a039092169260ff1685565b6000808060015b600160a060020a033316600090815260056020526040902060039081015460ff16908111156105a057fe5b146105fc576105f5606060405190810160405280602581526020017f55736572206973206e6f74206163746976652c204875622e6164645265736f75815260200160d860020a64726365282902815250610cab565b9250610959565b83151561065e576105f5606060405190810160405280602981526020017f496e766c61696420656d707479207265736f757263652c204875622e61646452815260200160b860020a6865736f75726365282902815250610cab565b9250610959565b848460405180838380828437820191505092505050604051908190039020915060005b60008381526003602081905260409091206004015460ff16908111156106a357fe5b14610704576105f5606060405190810160405280602a81526020017f5265736f7572636520616c7265616479206578697374732c204875622e616464815260200160b060020a695265736f75726365282902815250610cab565b9250610959565b600154600160a060020a03166340c10f19336103e860006040516020015260405160e060020a63ffffffff8516028152600160a060020a0390921660048301526024820152604401602060405180830381600087803b151561076557600080fd5b6102c65a03f1151561077657600080fd5b50505060405180519150508015156107e2576105f5606060405190810160405280602881526020017f556e61626c6520746f206d696e7420746f6b656e732c204875622e6164645265815260200160c060020a67736f75726365282902815250610cab565b9250610959565b60028054600181016107f48382610d4f565b916000526020600020900160005b508390555060a06040519081016040528086868080601f0160208091040260200160405190810160405281815292919060208401838380828437505050928452505050600160a060020a03331660208201526000604082015243606082015260800160015b9052600083815260036020526040902081518190805161088b929160200190610d79565b506020820151600182018054600160a060020a031916600160a060020a03929092169190911790556040820151816002015560608201518160030155608082015160048201805460ff191660018360038111156108e457fe5b02179055509050507f413d05b8bb326cef7511810161c97e50e07475497cb0c04dc8b407faf7991ab833868643604051600160a060020a0385168152604081018290526060602082018181529082018490526080820185858082843782019150509550505050505060405180910390a1600192505b505092915050565b6000805433600160a060020a039081169116146109cc576109c5606060405190810160405280602281526020017f6d73672e73656e64657220213d206f776e65722c204875622e61646455736572815260200160f060020a61282902815250610cab565b9050610c19565b60005b600160a060020a038916600090815260056020526040902060039081015460ff16908111156109fa57fe5b14610a53576109c5606060405190810160405280602281526020017f5573657220616c7265616479206578697374732c204875622e61646455736572815260200160f060020a61282902815250610cab565b9050610c19565b6004805460018101610a658382610d4f565b916000526020600020900160005b8154600160a060020a03808d166101009390930a928302920219161790555060806040519081016040528088888080601f0160208091040260200160405190810160405281815292919060208401838380828437820191505050505050815260200186868080601f0160208091040260200160405190810160405281815292919060208401838380828437820191505050505050815260200184848080601f016020809104026020016040519081016040528181529291906020840183838082843750505092845250506020909101905060015b9052600160a060020a0389166000908152600560205260409020815181908051610b75929160200190610d79565b50602082015181600101908051610b90929160200190610d79565b50604082015181600201908051610bab929160200190610d79565b5060608201518160030160006101000a81548160ff02191690836003811115610bd057fe5b02179055509050507f187047b56eb20e7a0313254e37dc60b8c1a9d25707114d2caaaee420b2b7ec2388604051600160a060020a03909116815260200160405180910390a15060015b979650505050505050565b600154600160a060020a031681565b610c3b610e22565b6004805480602002602001604051908101604052809291908181526020018280548015610c9157602002820191906000526020600020905b8154600160a060020a03168152600190910190602001808311610c73575b505050505090505b90565b600054600160a060020a031681565b60007f551303dd5f39cbfe6daba6b3e27754b8a7d72f519756a2cde2b92c2bbde159a78260405160208082528190810183818151815260200191508051906020019080838360005b83811015610d0c5780820151818401525b602001610cf3565b50505050905090810190601f168015610d395780820380516001836020036101000a031916815260200191505b509250505060405180910390a15060005b919050565b815481835581811511610d7357600083815260209020610d73918101908301610e34565b5b505050565b828054600181600116156101000203166002900490600052602060002090601f016020900481019282601f10610dba57805160ff1916838001178555610de7565b82800160010185558215610de7579182015b82811115610de7578251825591602001919060010190610dcc565b5b50610df4929150610e34565b5090565b815481835581811511610d7357600083815260209020610d73918101908301610e34565b5b505050565b60206040519081016040526000815290565b610c9991905b80821115610df45760008155600101610e3a565b5090565b90565b610c9991905b80821115610df45760008155600101610e3a565b5090565b905600a165627a7a723058206614e0350b7a5c46c9e5dfe261fa50e79e9ea17e7e1424e9afa4a7fd540ada9a0029",
  "networks": {
    "1507570987209": {
      "events": {
        "0x551303dd5f39cbfe6daba6b3e27754b8a7d72f519756a2cde2b92c2bbde159a7": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "errorString",
              "type": "string"
            }
          ],
          "name": "LogErrorString",
          "type": "event"
        },
        "0x413d05b8bb326cef7511810161c97e50e07475497cb0c04dc8b407faf7991ab8": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "resourceUrl",
              "type": "string"
            },
            {
              "indexed": false,
              "name": "blockNumber",
              "type": "uint256"
            }
          ],
          "name": "LogResourceAdded",
          "type": "event"
        },
        "0x187047b56eb20e7a0313254e37dc60b8c1a9d25707114d2caaaee420b2b7ec23": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "user",
              "type": "address"
            }
          ],
          "name": "LogUserAdded",
          "type": "event"
        }
      },
      "links": {},
      "address": "0x7ed48643bc97b48611754aa8a1e6e866a84dd858",
      "updated_at": 1507587729352
    },
    "1507665091422": {
      "events": {
        "0x413d05b8bb326cef7511810161c97e50e07475497cb0c04dc8b407faf7991ab8": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "user",
              "type": "address"
            },
            {
              "indexed": false,
              "name": "resourceUrl",
              "type": "string"
            },
            {
              "indexed": false,
              "name": "blockNumber",
              "type": "uint256"
            }
          ],
          "name": "LogResourceAdded",
          "type": "event"
        },
        "0x187047b56eb20e7a0313254e37dc60b8c1a9d25707114d2caaaee420b2b7ec23": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "user",
              "type": "address"
            }
          ],
          "name": "LogUserAdded",
          "type": "event"
        },
        "0x551303dd5f39cbfe6daba6b3e27754b8a7d72f519756a2cde2b92c2bbde159a7": {
          "anonymous": false,
          "inputs": [
            {
              "indexed": false,
              "name": "errorString",
              "type": "string"
            }
          ],
          "name": "LogErrorString",
          "type": "event"
        }
      },
      "links": {},
      "address": "0x21808e0d63d2fd3c5579a4425d3e9314ae47c6b9",
      "updated_at": 1507669773142
    }
  },
  "schema_version": "0.0.5",
  "updated_at": 1507669773142
}
