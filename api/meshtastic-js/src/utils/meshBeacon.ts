import { fromBinary } from "@bufbuild/protobuf";
import { BinaryReader, WireType } from "@bufbuild/protobuf/wire";
import * as Protobuf from "@meshtastic/protobufs";

/** `meshtastic.MeshBeacon` (MESH_BEACON_APP); the published protobufs package does not export it */
export interface MeshBeacon {
  message: string;
  offerChannel?: Protobuf.Channel.ChannelSettings;
  offerRegion: number;
  offerPreset?: number;
}

export const decodeMeshBeacon = (payload: Uint8Array): MeshBeacon => {
  const reader = new BinaryReader(payload);
  const beacon: MeshBeacon = { message: "", offerRegion: 0 };
  while (reader.pos < reader.len) {
    const [fieldNo, wireType] = reader.tag();
    if (fieldNo === 1 && wireType === WireType.LengthDelimited) {
      beacon.message = reader.string();
    } else if (fieldNo === 2 && wireType === WireType.LengthDelimited) {
      beacon.offerChannel = fromBinary(
        Protobuf.Channel.ChannelSettingsSchema,
        reader.bytes(),
      );
    } else if (fieldNo === 3 && wireType === WireType.Varint) {
      beacon.offerRegion = reader.int32();
    } else if (fieldNo === 4 && wireType === WireType.Varint) {
      beacon.offerPreset = reader.int32();
    } else {
      reader.skip(wireType, fieldNo);
    }
  }
  return beacon;
};
