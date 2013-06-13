(function () {
    'use strict';

    var API_SERVER = window.location.hostname + ':9004',
        SITE_URL = 'http://lounge.ajf.me';

    var mode, socket, errored = false;

    var state = {
        users: {},
        viewers: 0,
        title: '',
        widgets: [],
        widgetState: [],
        widgetDOM: []
    }, haveControl = false, pollVote = null, chatNick = null;

    var inFocus = true, unreadMessages = 0;

    function $(id) {
        return document.getElementById(id);
    }

    window.onload = function () {
        var id, control;

        // get them before IE errors out
        if (!Object.prototype.hasOwnProperty.call(window, 'WebSocket')) {
            document.innerHTML = 'Lounge requires a browser that supports WebSocket, such as Google Chrome, Mozilla Firefox, Apple Safari, Opera or Internet Explorer 10. Sorry :(';
            return;
        }

        // disable document-hiding style
        $('site').className = '';

        // display basic UI elements present on all pages
        initBasic();

        // display correct page for URL
        if (window.location.pathname === '/') {
            mode = 'home';
            initHome();
        } else if (window.location.pathname[0] === '/') {
            mode = 'view';
            id = window.location.pathname.substr(1);
            // get secret from URL hash
            if (window.location.hash.substr(0, 9) === '#control=') {
                control = window.location.hash.substr(9);
            // if using legacy query string format, redirect
            } else if (window.location.search.substr(0, 9) === '?control=') {
                control = window.location.search.substr(9);
                window.location = '/' + id + '#control=' + control;
                return;
            // get secret from localStorage if we had it backed up and redirect
            } else if (localStorage.getItem('secret-' + id) !== null) {
                control = localStorage.getItem('secret-' + id);
                window.location = '/' + id + '#control=' + control;
            }
            initView(id, control);
        } else {
            mode = '404';
            init404();
        }
    };

    function doAJAX(method, url, data, callback, errback) {
        var xhr;

        xhr = new XMLHttpRequest();
        xhr.open(method, 'http://' + API_SERVER + url);
        xhr.setRequestHeader('Content-Type', 'application/json; charset=utf-8');
        xhr.onreadystatechange = function () {
            if (xhr.readyState === 4) {
                if (xhr.status === 200) {
                    callback(JSON.parse(xhr.responseText));
                } else {
                    errback(xhr);
                }
            }
        };
        if (data) {
            xhr.send(JSON.stringify(data));
        } else {
            xhr.send();
        }
    }

    function appendText(parent, text) {
        parent.appendChild(document.createTextNode(text));
    }

    function appendTextAutoFormat(parent, text) {
        var pos, pos2, anchor, spoiler;
        while (text) {
            if ((pos = text.indexOf('http://')) !== -1 || (pos = text.indexOf('https://')) !== -1) {
                pos2 = text.indexOf(' ', pos);
                anchor = document.createElement('a');
                anchor.className = 'chat-format-link';
                anchor.target = '_blank';
                if (pos2 === -1) {
                    appendText(parent, text.substr(0, pos));
                    anchor.href = text.substr(pos);
                    appendText(anchor, text.substr(pos));

                    text = '';
                } else {
                    appendText(parent, text.substr(0, pos));
                    anchor.href = text.substr(pos, pos2 - pos);
                    appendText(anchor, text.substr(pos, pos2 - pos));
                    text = text.substr(pos2);
                }
                parent.appendChild(anchor);
            } else if ((pos = text.indexOf('[spoiler]')) !== -1 && (pos2 = text.indexOf('[/spoiler]', pos)) !== -1) {
                spoiler = document.createElement('span');
                spoiler.className = 'chat-format-spoiler';
                appendText(parent, text.substr(0, pos));
                appendText(spoiler, text.substr(pos + 9, pos2 - (pos + 9)));
                parent.appendChild(spoiler);
                text = text.substr(pos2 + 10);
            } else {
                appendText(parent, text);
                text = '';
            }
        }
    }

    function send(msg) {
        socket.send(JSON.stringify(msg));
    }

    function scrollChatlog() {
        $('chatlog').scrollTop = $('chatlog').scrollHeight;
    }

    function newMessage() {
        if (!inFocus) {
            unreadMessages++;
            document.title = '(' + unreadMessages + ') ' + state.title + ' - Lounge';
        }
    }

    function onChangeVisibility() {
        inFocus = !(document.hidden || document.webkitHidden || document.mozHidden || document.msHidden);
        console.log(inFocus);
        if (unreadMessages && inFocus) {
            document.title = state.title + ' - Lounge';
            unreadMessages = 0;
        }
    };

    // homepage
    function initHome() {
        // do nothing, default page state is homepage
    }

    function initBasic() {
        $('create-new').onclick = function () {
            var title;

            title = prompt('Enter a title:', '');
            if (title) {
                doAJAX('POST', '/new', {
                    title: title
                }, function (response) {
                    // back up the secret
                    localStorage.setItem('secret-' + response.chatroom.id, response.chatroom.secret);
                    window.location = '/' + response.chatroom.id + '#control=' + response.chatroom.secret;
                }, function (xhr) {
                    alert('Error while trying to create new sync:\nResponse code:\n' + xhr.status + '\nError message:' + xhr.responseText);
                });
            }
        };

        if (localStorage.getItem('bgcolor') !== null) {
            document.body.style.backgroundColor = localStorage.getItem('bgcolor');
        }

        $('color-chooser').onchange = function () {
            document.body.style.backgroundColor = $('color-chooser').value;
            localStorage.setItem('bgcolor', $('color-chooser').value);
        };
    }

    // selectedOptions support emulation for Firefox
    function selectedOptions(select) {
        var list = [], i;

        if (select.hasOwnProperty('selectedOptions')) {
            return select.selectedOptions;
        } else {
            for (i = 0; i < select.options.length; i++) {
                if (select.options[i].selected) {
                    list.push(select.options[i]);
                }
            }
            return list;
        }
    }

    // sync viewing page
    function initView(id, control) {
        var url;

        // replace homepage with loading message
        $('homepage').innerHTML = 'Connecting...';

        socket = new WebSocket('ws://' + API_SERVER, ['lounge']);
        socket.onopen = function () {
            // set our chatroom (subscribe to events) and get info on it
            send({
                type: 'set_chatroom',
                id: id,
                control: control
            });
        };
        socket.onerror = socket.onclose = function (err) {
            if (errored) {
                return;
            }
            $('homepage').innerHTML = 'Error communicating with server, lost connection (server may be down, Lounge may have updated, try refreshing):\n' + err;
            errored = true;
        };
        socket.onmessage = function (event) {
            var msg, chatroom, elem, elem2, elem3, nick, results, totalVotes, resultStrings, resultSegments;

            msg = JSON.parse(event.data);

            switch (msg.type) {
                case 'chatroom_info':
                    // replace homepage with viewing page template
                    $('homepage').innerHTML = $('viewpage-template').innerHTML;
                
                    chatroom = msg.chatroom;

                    // display chatroom title
                    $('title').innerHTML = '';
                    $('title').appendChild(document.createTextNode(chatroom.title));
                    $('titlebox').value = chatroom.title;
                    document.title = chatroom.title + ' - Lounge';
                    state.title = chatroom.title;

                    // display chatroom viewing URL
                    $('view-link').value = SITE_URL + '/' + chatroom.id;

                    // update state
                    state.poll = chatroom.poll;
                    state.viewers = chatroom.viewers;

                    // display poll
                    updatePoll();

                    // display user count
                    updateUsersOnline();

                    // if we have control of the chatroom
                    if (msg.control) {
                        haveControl = true;

                        // allow changing title
                        $('titlebox').disabled = false;
                        $('titlebox').onchange = function () {
                            send({
                                type: 'change_title',
                                title: $('titlebox').value
                            });
                            state.title = $('titlebox').value;
                            document.title = $('titlebox').value + ' - Lounge';
                            $('title').innerHTML = '';
                            $('title').appendChild(document.createTextNode($('titlebox').value));
                        };

                        // unhide widgets controls box
                        $('widgets-controls').className = '';

                        // display chatroom control URL
                        $('control-link').value = SITE_URL + '/' + chatroom.id + '#control=' + control;

                        // make Add widget button work
                        $('add-widget').onclick = function () {
                            send({
                                type: 'add_widget',
                                widget: $('widget-choice').value
                            });
                        };
                    }

                    // initialise widgets
                    initWidgets(chatroom.widgets, chatroom.widgetState);

                    // make chat work
                    $('login-btn').disabled = false;
                    $('login-btn').onclick = function () {
                        navigator.id.request();
                    };
                    $('chatbox').placeholder = 'choose a nick (press enter)';
                    $('chatbox').onkeypress = function (e) {
                        // enter
                        if (e.which === 13) {
                            e.preventDefault();
                            if (chatNick === null) {
                                send({
                                    type: 'set_nick',
                                    nick: $('chatbox').value
                                });
                                $('chatbox').disabled = true;
                                $('chatbox').value = '';
                            } else if ($('chatbox').value) {
                                send({
                                    type: 'msg',
                                    msg: $('chatbox').value
                                });
                                $('chatbox').value = '';
                            }
                            return false;
                        }
                    };
                    navigator.id.watch({
                        loggedInUser: null,
                        onlogin: function (assertion) {
                            if (chatNick === null) {
                                send({
                                    type: 'assert',
                                    assertion: assertion
                                });
                                $('login-btn').disabled = true;
                                $('login-btn').innerHTML = 'logging in...';
                            }
                        },
                        onlogout: function () {
                            window.location.reload();
                        }
                    });
                    window.onresize = scrollChatlog;
                    if (document.hasOwnProperty('hidden')) {
                        document.addEventListener('visibilitychange', onChangeVisibility);
                    } else if (document.hasOwnProperty('mozHidden')) {
                        document.addEventListener('mozvisibilitychange', onChangeVisibility);
                    } else if (document.hasOwnProperty('msHidden')) {
                        document.addEventListener('msvisibilitychange', onChangeVisibility);
                    } else if (document.hasOwnProperty('webkitHidden')) {
                        document.addEventListener('webkitvisibilitychange', onChangeVisibility);
                    }
                break;
                case 'change_title':
                    $('titlebox').value = msg.title;
                    state.title = msg.title;
                    $('title').innerHTML = '';
                    $('title').appendChild(document.createTextNode(msg.title));
                    document.title = msg.title + ' - Lounge';
                    elem = document.createElement('div');
                    elem.className = 'chat chat-title-change';
                    elem.appendChild(document.createTextNode('* Title was changed to "' + msg.title + '"' + (msg.by ? (' by ' + msg.by) : '')));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                break;
                case 'join':
                    elem = document.createElement('div');
                    elem.className = 'chat chat-join';
                    elem.appendChild(document.createTextNode('* ' + msg.prefix + msg.nick + ' joined chat'));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    state.users[msg.nick] = {
                        prefix: msg.prefix
                    };
                    updateUsersOnline();
                    newMessage();                    
                break;
                case 'leave':
                    elem = document.createElement('div');
                    elem.className = 'chat chat-leave';
                    elem.appendChild(document.createTextNode('* ' + msg.prefix + msg.nick + ' left chat'));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    delete state.users[msg.nick];
                    updateUsersOnline();
                    newMessage();
                break;
                case 'mute':
                    elem = document.createElement('div');
                    elem.className = 'chat chat-mute';
                    elem.appendChild(document.createTextNode('* ' + msg.nick + ' was muted by ' + msg.by));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    state.users[msg.nick].prefix = '~';
                    if (chatNick === msg.nick) {
                        $('chatbox').disabled = true;
                    }
                    updateUsersOnline();
                    newMessage();
                break;
                case 'unmute':
                    elem = document.createElement('div');
                    elem.className = 'chat chat-unmute';
                    elem.appendChild(document.createTextNode('* ~' + msg.nick + ' was unmuted by ' + msg.by));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    state.users[msg.nick].prefix = msg.prefix;
                    if (chatNick === msg.nick) {
                        $('chatbox').disabled = false;
                    }
                    updateUsersOnline();
                    newMessage();
                break;
                case 'poll':
                    state.poll = msg.poll;
                    pollVote = msg.poll_vote;
                    updatePoll();
                break;
                case 'chat_users':
                    state.users = msg.users;
                    updateUsersOnline();
                break;
                case 'viewers':
                    state.viewers = msg.count;
                    updateUsersOnline();
                break;
                case 'msg':
                case 'action':
                    elem = document.createElement('div');
                    elem2 = document.createElement('span');
                    elem2.className = 'chat-format-nick';
                    elem2.appendChild(document.createTextNode(msg.nick));
                    if (msg.type === 'action') {
                        elem.appendChild(document.createTextNode('* '));
                        elem.className = 'chat chat-action';
                    } else {
                        elem.className = 'chat chat-msg';
                    }
                    elem.appendChild(elem2);
                    if (msg.type === 'msg') {
                        elem.appendChild(document.createTextNode(': '));
                    } else {
                        elem.appendChild(document.createTextNode(' '));
                    }
                    if (msg.msg[0] === '>') {
                        elem3 = document.createElement('span');
                        elem3.className = 'chat-format-greentext';
                        appendTextAutoFormat(elem3, msg.msg);
                        elem.appendChild(elem3);
                    } else {
                        appendTextAutoFormat(elem, msg.msg);
                    }
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    newMessage();
                break;
                case 'poll_results':
                    elem = document.createElement('div');
                    elem.className = 'chat chat-poll-results';

                    results = [];
                    totalVotes = 0;

                    Object.keys(msg.results).forEach(function (option) {
                        // total vote count
                        totalVotes += msg.results[option].length;

                        // gather results into array so we can sort them
                        results.push({
                            title: option,
                            votes: msg.results[option]
                        });
                    });

                    // sort
                    results.sort(function (a, b) {
                        a = a.votes.length;
                        b = b.votes.length;
                        if (a < b) {
                            return 1;
                        } else if (a > b) {
                            return -1;
                        }
                        return 0;
                    });

                    // make results string
                    resultStrings = [];
                    results.forEach(function (option) {
                        resultStrings.push(option.title + ' - ' + option.votes.length + '/' + totalVotes + ', ' + (100 * (option.votes.length / totalVotes)).toFixed(1) + '% (' + option.votes.join(', ') + ')');
                    });
                    elem.appendChild(document.createTextNode('* ' + 'Poll "' + msg.title + '" closed by ' + msg.closed_by + ', results: ' + resultStrings.join('; ')));

                    // make results chart
                    resultSegments = [];
                    results.forEach(function (option) {
                        if (option.votes.length) {
                            resultSegments.push({
                                label: option.title + ' (' + (100 * (option.votes.length / totalVotes)).toFixed(1) + '%)',
                                size: option.votes.length
                            });
                        }
                    });
                    AJFChart.create(elem, 200, 200, resultSegments);

                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    newMessage();
                break;
                case 'chat_info':
                    elem = document.createElement('div');
                    elem.className = 'chat chat-info';
                    elem.appendChild(document.createTextNode('* ' + msg.msg));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    newMessage();
                break;
                case 'nick_chosen':
                    $('chatbox').placeholder = 'say something (press enter)';
                    chatNick = msg.nick;
                    // disable chatbox if muted, else enable
                    $('chatbox').disabled = (msg.prefix === '~');
                    $('login-btn').className = 'unloaded';
                    $('chatbox').className = '';
                    $('logout-btn').className = '';
                    $('logout-btn').onclick = function () {
                        navigator.id.logout();
                    };
                    $('chat-btn').className = '';
                    $('chat-btn').onclick = function () {
                        if ($('chatbox').value) {
                            send({
                                type: 'msg',
                                msg: $('chatbox').value
                            });
                            $('chatbox').value = '';
                        }
                    };
                    updatePoll();
                break;
                case 'nick_in_use':
                    alert('The nick "' + msg.nick + '" is in use - log out first.');
                    $('login-btn').className = 'unloaded';
                break;
                case 'choose_nick':
                    nick = prompt((msg.reason === 'nick_taken' ? 'That nickname was taken. ' : '') + "Choose your nickname (3-18 characters, digits, letters and underscores only):");
                    if (nick === null) {
                        $('login-btn').innerHTML = 'Log in';
                        $('login-btn').disabled = false;
                        return;
                    }
                    while (!nick.match(/^[a-zA-Z0-9_]{3,18}$/g)) {
                        nick = prompt("That nickname wasn't valid.\nChoose your nickname (3-18 characters, digits, letters and underscores only):");
                        if (nick === null) {
                            $('login-btn').innerHTML = 'Log in';
                            $('login-btn').disabled = false;
                            return;
                        }
                    }
                    send({
                        type: 'set_nick',
                        nick: nick
                    });
                break;
                case 'add_widget':
                    addWidget(msg.widget, msg.widgetState);
                break;
                case 'update_widget':
                    updateWidget(msg.id, msg.widgetState);
                break;
                case 'remove_widget':
                    removeWidget(msg.id);
                break;
                case 'update':
                    elem = document.createElement('div');
                    elem.className = 'chat chat-update';
                    elem.appendChild(document.createTextNode('* Lounge is updating, page will refresh in 5 seconds'));
                    $('chatlog').appendChild(elem);
                    scrollChatlog();
                    errored = true;
                    setTimeout(function () {
                        window.location.reload();
                    }, 5000);
                break;
                case 'error':
                default:
                    if (msg.error === 'not_found') {
                        init404();
                    } else {
                        $('homepage').innerHTML = 'Error communicating with server, lost connection:\n' + msg.error || ('Unknown packet type: ' + msg.type);
                    }
                    errored = true;
                break;
            }
        };
    }

    // "404" page
    function init404() {
        document.title = '404 not found - Lounge';
        // replace homepage with 404 message
        $('homepage').innerHTML = '404 - page not found. This page either never existed or no longer existed, are you sure you typed the URL right?';
    }

    function updateUsersOnline() {
        var i, elem, userKeys;

        // sort nicks case-insensitively inclusive of prefix
        userKeys = _.keys(state.users).sort(function (a, b) {
            a = state.users[a].prefix + a.toLowerCase();
            b = state.users[b].prefix + b.toLowerCase();
            if (a < b) {
                return -1;
            } else if (a > b) {
                return 1;
            }

            return 0;
        });
        $('users-online').innerHTML = _.size(state.users) + '/' + state.viewers + ' viewers in chat:';
        elem = document.createElement('ul');
        _.each(userKeys, function (nick) {
            var option, user = state.users[nick];

            option = document.createElement('li');
            option.className = 'user user--' + nick.toLowerCase();
            if (user.prefix === '@') {
                option.className += ' user-op';
            } else if (user.prefix === '~') {
                option.className += ' user-muted';
            }
            option.appendChild(document.createTextNode(user.prefix + nick));
            elem.appendChild(option);
        });
        $('users-online').appendChild(elem);
    }

    function updatePoll() {
        var i, elem, name, totalVotes, results = [], resultSegments = [], poll = state.poll;

        if (poll) {
            $('poll').className = '';
            $('poll').innerHTML = '';
            elem = document.createElement('h2');
            elem.appendChild(document.createTextNode('Poll: ' + poll.title));
            $('poll').appendChild(elem);
            elem = document.createElement('ul');
            totalVotes = 0;
            Object.keys(poll.options).forEach(function (name) {
                var option, btn;
                option = document.createElement('li');
                if (pollVote === null && chatNick !== null) {
                    btn = document.createElement('button');
                    btn.appendChild(document.createTextNode(name));
                    (function (name) {
                        btn.onclick = function () {
                            send({
                                type: 'vote',
                                option: name
                            });
                            pollVote = name;
                            updatePoll();
                        };
                    }(name));
                    option.appendChild(btn);
                } else {
                    option.appendChild(document.createTextNode((pollVote === name ? '▶ ' : '') + name));
                }
                option.appendChild(document.createTextNode(' (' + poll.options[name].length + ' votes - ' + poll.options[name].join(', ') + ')'));
                elem.appendChild(option);

                totalVotes += poll.options[name].length;
                // gather results into array so we can sort them
                results.push({
                    title: name,
                    votes: poll.options[name]
                });
            });
            $('poll').appendChild(elem);

            // sort
            results.sort(function (a, b) {
                a = a.votes.length;
                b = b.votes.length;
                if (a < b) {
                    return 1;
                } else if (a > b) {
                    return -1;
                }
                return 0;
            });

            // make results chart
            resultSegments = [];
            results.forEach(function (option) {
                if (option.votes.length) {
                    resultSegments.push({
                        label: option.title + ' (' + (100 * (option.votes.length / totalVotes)).toFixed(1) + '%)',
                        size: option.votes.length
                    });
                }
            });
            AJFChart.create(elem, 200, 200, resultSegments);
        } else {
            $('poll').className = 'unloaded';
        }
    }

    function initWidgets(widgets, widgetState) {
        state.widgets = widgets;
        state.widgetState = widgetState;
        state.widgets.forEach(function (widget, i) {
            state.widgetDOM.push(initWidget(i, widget, state.widgetState[i]));
        });
    }

    function addWidget(widget, widgetState) {
        state.widgets.push(widget);
        state.widgetState.push(widgetState);
        state.widgetDOM.push(initWidget(state.widgets.length - 1, widget, widgetState));
    }

    function updateWidget(id, widgetState) {
        state.widgetState[id] = widgetState;
        refreshWidget(id, state.widgets[id], state.widgetState[id], state.widgetDOM[id]);
    }

    function removeWidget(id) {
        teardownWidget(id, state.widgets[id], state.widgetState[id], state.widgetDOM[id]);
        state.widgets.splice(id, 1);
        state.widgetState.splice(id, 1);
        state.widgetDOM.splice(id, 1);
    }

    function initWidget(id, name, widgetState) {
        var DOM = {};

        DOM.container = document.createElement('div');
        DOM.container.className = 'widget';

        if (haveControl) {
            DOM.remove = document.createElement('button');
            DOM.remove.title = 'Remove widget';
            DOM.remove.className = 'widget-remove';
            DOM.remove.onclick = function () {
                send({
                    type: 'remove_widget',
                    id: state.widgetDOM.indexOf(DOM)
                });
            };
            DOM.removeImg = document.createElement('img');
            DOM.removeImg.src = '/media/delete.png';
            DOM.removeImg.alt = 'Remove widget';
            DOM.remove.appendChild(DOM.removeImg);
            appendText(DOM.remove, ' Remove widget');
            DOM.container.appendChild(DOM.remove);
        }

        switch (name) {
            case 'gg2Lobby':
                DOM.controls = document.createElement('div');
                DOM.controls.className = 'gg2lobby-controls unloaded';
                DOM.container.appendChild(DOM.controls);

                DOM.teamSelector = document.createElement('select');
                DOM.teamSelector.className = 'gg2lobby-team-selector';
                DOM.teamSelector.onchange = function () {
                    send({
                        type: 'gg2lobby_change_team',
                        id: state.widgetDOM.indexOf(DOM),
                        team: DOM.teamSelector.value
                    });
                };
                DOM.controls.appendChild(DOM.teamSelector);

                ['spectator', 'red', 'blue'].forEach(function (teamName, index) {
                    var elem;

                    DOM['teamSelectOption'] = elem = document.createElement('option');
                    elem.value = teamName;
                    appendText(elem, (index === 9 ? 'Q' : index) + ' - ' + teamName[0].toUpperCase() + teamName.slice(1));
                    DOM.teamSelector.appendChild(elem);
                });

                DOM.classSelector = document.createElement('select');
                DOM.classSelector.className = 'gg2lobby-class-selector';
                DOM.classSelector.onchange = function () {
                    send({
                        type: 'gg2lobby_change_class',
                        id: state.widgetDOM.indexOf(DOM),
                        className: DOM.classSelector.value
                    });
                };
                DOM.controls.appendChild(DOM.classSelector);

                ['runner', 'firebug', 'rocketman', 'overweight', 'detonator', 'healer', 'constructor', 'infiltrator', 'rifleman', 'querly'].forEach(function (className, index) {
                    var elem;

                    DOM['classSelectOption'] = elem = document.createElement('option');
                    elem.value = className;
                    appendText(elem, (index === 9 ? 'Q' : index) + ' - ' + className[0].toUpperCase() + className.slice(1));
                    DOM.classSelector.appendChild(elem);
                });

                DOM.readyLabel = document.createElement('label');
                DOM.readyLabel.className = 'gg2lobby-ready';
                DOM.ready = document.createElement('input');
                DOM.ready.type = 'checkbox';
                DOM.ready.onchange = function () {
                    send({
                        type: 'gg2lobby_set_ready',
                        id: state.widgetDOM.indexOf(DOM),
                        ready: DOM.ready.checked
                    });
                };
                DOM.readyLabel.appendChild(DOM.ready);                
                appendText(DOM.readyLabel, ' Ready');
                DOM.controls.appendChild(DOM.readyLabel);

                DOM.spectator = document.createElement('div');
                DOM.spectator.className = 'gg2lobby-team';
                DOM.container.appendChild(DOM.spectator);

                DOM.red = document.createElement('div');
                DOM.red.className = 'gg2lobby-team gg2lobby-red';
                DOM.container.appendChild(DOM.red);

                DOM.blue = document.createElement('div');
                DOM.blue.className = 'gg2lobby-team gg2lobby-blue';
                DOM.container.appendChild(DOM.blue);

                DOM.spectatorHeading = document.createElement('h2');
                appendText(DOM.spectatorHeading, 'Spectator');
                DOM.spectator.appendChild(DOM.spectatorHeading);

                DOM.redHeading = document.createElement('h2');
                appendText(DOM.redHeading, 'Red');
                DOM.red.appendChild(DOM.redHeading);

                DOM.blueHeading = document.createElement('h2');
                appendText(DOM.blueHeading, 'Blue');
                DOM.blue.appendChild(DOM.blueHeading);

                DOM.spectatorList = document.createElement('ul');
                DOM.spectator.appendChild(DOM.spectatorList);

                DOM.redList = document.createElement('ul');
                DOM.red.appendChild(DOM.redList);

                DOM.blueList = document.createElement('ul');
                DOM.blue.appendChild(DOM.blueList);

                refreshWidget(id, name, widgetState, DOM);
            break;
        }

        $('widgets-container').appendChild(DOM.container);

        return DOM;
    }

    function refreshWidget(id, name, widgetState, DOM) {
        var canEdit = false;

        switch (name) {
            case 'gg2Lobby':
                DOM.redList.innerHTML = '';
                DOM.blueList.innerHTML = '';
                DOM.spectatorList.innerHTML = '';

                widgetState.players.forEach(function (player) {
                    var li, img, input;

                    li = document.createElement('li');

                    if (player.team !== 'spectator') {
                        img = document.createElement('img');
                        img.src = '/media/classes/' + player.className + '.png';
                        img.alt = img.title = player.className[0].toUpperCase() + player.className.slice(1);
                        li.appendChild(img);
                    }

                    appendText(li, ' ' + player.name + ' ');

                    input = document.createElement('input');
                    input.type = 'checkbox';
                    input.disabled = true;
                    input.checked = player.ready;
                    li.appendChild(input);

                    if (player.team === 'spectator') {
                        DOM.spectatorList.appendChild(li);
                    } else if (player.team === 'red') {
                        DOM.redList.appendChild(li);
                    } else {
                        DOM.blueList.appendChild(li);
                    }

                    if (player.name === chatNick) {
                        canEdit = true;
                        DOM.teamSelector.value = player.team;
                        DOM.classSelector.value = player.className;
                        DOM.ready.checked = player.ready;
                    }
                });

                if (canEdit) {
                    DOM.controls.className = 'gg2lobby-controls';
                } else {
                    DOM.controls.className = 'gg2lobby-controls unloaded';
                }
            break;
        }
    }

    function teardownWidget(id, name, widgetState, DOM) {
        $('widgets-container').removeChild(DOM.container);
    }
}());
