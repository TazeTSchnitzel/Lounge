var fs = require('fs'),
    http = require('http'),
    entities = require('entities'),
    _ = require('underscore');

// internal variables and functions
var chatrooms = [];

function secs() {
    return new Date().getTime() / 1000;
}

function loadChatrooms() {
    if (fs.existsSync('chatrooms.json')) {
        var file = fs.readFileSync('chatrooms.json');
        var data = JSON.parse(file);

        // deserialise each chatroom
        data.chatrooms.forEach(function (chatroom) {
            chatrooms.push(new _Chatroom(chatroom));
        });
    }
}

function saveChatrooms() {
    fs.writeFileSync('chatrooms.json', JSON.stringify({
        chatrooms: chatrooms
    }));
    console.log('Saved chatrooms');
}

// generates 14-digit base36 secret
function generateSecret() {
    var i, secret = '';

    for (i = 0; i < 14; i++) {
        secret += Math.floor(Math.random() * 36).toString(36)
    }
    return secret;
}

// internal Chatroom constructor
// (deserialises from object with default)
function _Chatroom(obj) {
    this.title = obj.title;
    this.id = obj.id;
    this.secret = obj.secret;
    this.currentPoll = obj.currentPoll || null;
    this.mutedClients = obj.mutedClients || [];

    this.clients = [];
};

// serialise
_Chatroom.prototype.toJSON = function () {
    return {
        title: this.title,
        id: this.id,
        secret: this.secret,
        currentPoll: this.currentPoll,
        mutedClients: this.mutedClients
    };
};

// chat join h[oo|ac]k
_Chatroom.prototype.onJoinChat = function (client) {
    var that = this;

    // set poll_vote value to track if they already voted, where poll active
    if (this.hasPoll()) {
        Object.keys(this.currentPoll.options).forEach(function (option) {
            if (that.currentPoll.options[option].indexOf(client.chat_nick) !== -1) {
                client.poll_vote = option;
            }
        });
        client.send({
            type: 'poll',
            poll: this.getPoll(),
            poll_vote: client.poll_vote
        });
    }
};

// adds client to internal list
_Chatroom.prototype.addClient = function (client) {
    var that = this;

    if (this.clients.indexOf(client) !== -1) {
        throw new Error('Client already in list.');
    }

    this.clients.push(client);

    // count users viewing chatroom
    this.forEachClient(function (cl) {
        cl.send({
            type: 'viewers',
            count: that.usersViewing()
        });
    });
    console.log('now ' + this.usersViewing() + ' users viewing chatroom ' + this.id);
};

// removes client from internal list
_Chatroom.prototype.removeClient = function (client) {
    var that = this;

    if (this.clients.indexOf(client) === -1) {
        throw new Error('Client is not in list.');
    }

    this.clients.splice(this.clients.indexOf(client), 1);

    // count users viewing chatroom
    this.forEachClient(function (cl) {
        cl.send({
            type: 'viewers',
            count: that.usersViewing()
        });
    });
    console.log('now ' + this.usersViewing() + ' users viewing chatroom ' + this.id);
};

// return number of users viewing chatroom
_Chatroom.prototype.usersViewing = function () {
    return this.clients.length;
};

// iterate over each client, calling callback for each
_Chatroom.prototype.forEachClient = function (callback) {
    this.clients.forEach(callback);
};

// check if we have a given client by nick, case-insensitive
_Chatroom.prototype.hasNick = function (nick) {
    return !!_.find(this.clients, function (cl) {
        return cl.chat_nick && cl.chat_nick.toLowerCase() === nick.toLowerCase();
    });
};

// get a given client by nick, case-insensitive
_Chatroom.prototype.getByNick = function (nick) {
    var cl = _.find(this.clients, function (cl) {
        return cl.chat_nick && cl.chat_nick.toLowerCase() === nick.toLowerCase();
    });

    if (!nick) {
        throw new Error('No such nick: "' + nick + '"');
    }

    return cl;
};

// returns count of clients viewing
_Chatroom.prototype.clientsViewing = function () {
    return this.clients.length;
};

// returns relative time (adjusted since last update)
_Chatroom.prototype.getRelativeTime = function () {
    return this.time + (secs() - this.timeFrom);
};

// returns poll data
_Chatroom.prototype.getPoll = function () {
    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }
    return this.currentPoll;
};

// opens a poll
_Chatroom.prototype.openPoll = function (title, options, nick) {
    var that = this;

    // close poll first if one already running
    if (this.hasPoll()) {
        this.closePoll(nick);
    }

    this.currentPoll = {
        title: title,
        options: {}
    };
    options.forEach(function (arg) {
        that.currentPoll.options[arg] = [];
    });
    
    saveChatrooms();

    // update each client
    this.forEachClient(function (cl) {
        cl.poll_vote = null;
        cl.send({
            type: 'poll',
            poll: that.getPoll(),
            poll_vote: cl.poll_vote
        });
        cl.send({
            type: 'chat_info',
            msg: 'Poll "' + title + '" opened by ' + nick
        });
    });
};

// closes a poll
_Chatroom.prototype.closePoll = function (nick) {
    var results, title;

    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }

    results = this.currentPoll.options;
    title = this.currentPoll.title;
    this.currentPoll = null;
    saveChatrooms();

    // update each client
    this.forEachClient(function (cl) {
        cl.poll_vote = null;
        cl.send({
            type: 'poll',
            poll: null,
            poll_vote: cl.poll_vote
        });
        cl.send({
            type: 'poll_results',
            results: results,
            title: title,
            closed_by: nick
        });
    });
};

// returns true if we have a poll
_Chatroom.prototype.hasPoll = function () {
    return !!this.currentPoll;
};

// returns true if given client has already voted
_Chatroom.prototype.hasVoted = function (client) {
    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }
    return (client.poll_vote !== null);
};

// returns true if there is such a poll option
_Chatroom.prototype.hasPollOption = function (option) {
    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }
    return this.currentPoll.options.hasOwnProperty(option);
};

// makes vote
_Chatroom.prototype.vote = function (client, option) {
    var that = this;

    if (!this.hasPoll()) {
        throw new Error("There is no poll running.");
    }
    if (this.hasVoted(client)) {
        throw new Error("Client has already voted.");
    }
    if (!this.hasPollOption(option)) {
        throw new Error("No such poll option: " + option);
    }
    this.currentPoll.options[option].push(client.chat_nick);
    client.poll_vote = option;
    saveChatrooms();

    // update each client
    this.clients.forEach(function (cl) {
        cl.send({
            type: 'poll',
            poll: that.getPoll(),
            poll_vote: cl.poll_vote
        });
    });
};

// returns true if client is muted (by nick), else false
_Chatroom.prototype.isClientMuted = function (nick) {
    return _.contains(this.mutedClients, nick);
};

// mutes client, returns false on failure, 
_Chatroom.prototype.muteClient = function (client, nick) {
    var that = this;

    if (!_.contains(this.clients, client)) {
        throw new Error("Client is not attached to this chatroom.");
    }

    if (client.chat_nick === null) {
        throw new Error("Client is not in chat.");
    }

    if (client.control) {
        throw new Error("Client is controller, cannot be muted.");
    }

    // check this client isn't already muted
    if (this.isClientMuted(client.chat_nick)) {
        return;
    }

    client.prefix = '~';
    client.muted = true;
    
    this.mutedClients.push(client.chat_nick);
    saveChatrooms();    

    // update each client
    this.forEachClient(function (cl) {
        cl.send({
            type: 'mute',
            nick: client.chat_nick,
            by: nick
        });
    });
};

// unmutes client, returns false on failure, 
_Chatroom.prototype.unmuteClient = function (client, nick) {
    var that = this;

    if (!_.contains(this.clients, client)) {
        throw new Error("Client is not attached to this chatroom.");
    }

    if (client.chat_nick === null) {
        throw new Error("Client is not in chat.");
    }

    // check this client isn't already muted
    if (!_.contains(this.mutedClients, client.chat_nick)) {
        return;
    }

    // only one possible new prefix since controllers can't be muted
    client.prefix = '';
    client.muted = false;
    
    this.mutedClients = _.without(this.mutedClients, client.chat_nick);
    saveChatrooms();    

    // update each client
    this.forEachClient(function (cl) {
        cl.send({
            type: 'unmute',
            nick: client.chat_nick,
            prefix: client.prefix,
            by: nick
        });
    });
};

// changes title
_Chatroom.prototype.changeTitle = function (title, nick) {
    this.title = title;

    // update each client
    this.clients.forEach(function (cl) {
        cl.send({
            type: 'change_title',
            title: title,
            by: nick
        });
    });

    saveChatrooms();
};

// public Chatroom constructor (new chatroom)
function Chatroom(title) {
    var id, secret, s;

    // choose next ID (used in /<id> URL, base36-encoded index)
    id = chatrooms.length.toString(36);

    // generate new secret used to control the chatroom
    secret = generateSecret();

    s = new _Chatroom({
        id: id,
        secret: secret,
        title: title
    });

    chatrooms.push(s);

    saveChatrooms();

    return s;
}

// iterates over each chatroom and calls callback for each
Chatroom.forEach = function (callback) {
    chatrooms.forEach(callback);
};

// do we have such a chatroom?
Chatroom.haveChatroom = function (id) {
    // chatroom ID is base36-encoded index into array
    id = parseInt(id, 36);
    return chatrooms.hasOwnProperty(id);
};

// chatroom count
Chatroom.chatroomCount = function () {
    return chatrooms.length;
};

// get a chatroom by ID
Chatroom.get = function (id) {
    if (!this.haveChatroom(id)) {
        throw new Error("No such chatroom: " + id);
    }
    return chatrooms[parseInt(id, 36)];
};

loadChatrooms();

module.exports = Chatroom;
