import 'dart:async';
import 'package:flutter/foundation.dart';
import 'package:socket_io_client/socket_io_client.dart' as io_client;

class ArriSocketIoController<TIncoming, TOutgoing> {
  final io_client.Socket socket;
  final TIncoming Function(dynamic data) parser;
  final dynamic Function(TOutgoing data) serializer;

  bool isClosed = false;

  ArriSocketIoController({
    required this.socket,
    required this.parser,
    required this.serializer,
  });

  void send(TOutgoing message) {
    socket.emit('message', serializer(message));
  }

  void emit(String event, dynamic data) {
    socket.emit(event, data);
  }

  void sendBinary(String event, List<int> bytes) {
    socket.emit(event, bytes);
  }

  void close() {
    isClosed = true;
    socket.disconnect();
    socket.dispose();
  }

  void listen({
    required Function(TIncoming message) onMessage,
    Function(dynamic error)? onError,
    Function(String reason)? onDisconnect,
    Function()? onConnect,
  }) {
    if (onConnect != null) {
      socket.onConnect((_) => onConnect());
    }

    socket.on('message', (data) {
      if (data != null) {
        try {
          final parsed = parser(data);
          onMessage(parsed);
        } catch (e) {
          debugPrint("[ArriSocketIoController] Event parsing error: $e");
        }
      }
    });

    if (onError != null) {
      socket.onError((err) => onError(err));
    }

    if (onDisconnect != null) {
      socket.onDisconnect((reason) => onDisconnect(reason?.toString() ?? "disconnected"));
    }
  }
}

Future<ArriSocketIoController<TServerMessage, TClientMessage>>
    arriSocketIoRequest<TServerMessage, TClientMessage>(
  String url, {
  required TServerMessage Function(dynamic data) parser,
  required dynamic Function(TClientMessage data) serializer,
  Map<String, dynamic>? query,
  Function(Object)? onError,
}) async {
  final socket = io_client.io(
    url,
    io_client.OptionBuilder()
        .setTransports(['websocket', 'polling'])
        .disableAutoConnect()
        .setQuery(query ?? {})
        .build(),
  );

  socket.connect();

  return ArriSocketIoController<TServerMessage, TClientMessage>(
    socket: socket,
    parser: parser,
    serializer: serializer,
  );
}
