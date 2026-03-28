# Lake DLM Protocol v3.4 Notes

Source URL: https://beetech-inc.com/wp/wp-content/uploads/DLM-Lake-3rd-party-protocol-v3_4.pdf  
Retrieved: 2026-03-28

## Points used by the current plugin implementation

- Fixed response mode uses destination port `6015` and local receive port `6004`.
- Dynamic response mode uses destination port `6016`, and replies return to the source UDP port.
- The main packet header used by the example application is 28 bytes: source ID, destination ID, source class, destination class, length, packet type, and message ID.
- DLM packet fields are little-endian.
- Packet types used by the plugin are `2` (`Msg_Ack`), `4` (`Msg_BroadcastID`), `5` (`Msg_MultiBroadcastID`), and `701` (`Msg_DLMMsg`).
- Host class is `6`, device class is `5`, and broadcast class is `0`.
- DLM text payloads are null-terminated and padded to a 4-byte boundary.
- Appendix C's example code sends ordinary DLM command packets with a zero footer, but calculates a checksum for heartbeat discovery packets.

## Known inconsistencies in the PDF

- Section 4.2 describes dynamic replies returning to the originating source port, while section 6.2 still says replies must be received on `6004`.
- Appendix D shows DLM command examples with a zero footer, while Appendix E shows checksum-bearing packets.
- Appendix E also includes compact packet examples that do not match the larger packet structs used by Appendix C's example source code.

## Implementation choice

The plugin follows the Appendix C source-code behavior for current work:

- Outgoing DLM command packets use the full header layout and a zero footer.
- Outgoing heartbeat discovery packets use the full header layout and a computed checksum.
- Incoming ACK, message, and broadcast packets are parsed using the full header layout, while also tolerating zero-footers for interoperability.
