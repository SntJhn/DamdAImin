from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import torch
import torch.nn as nn
import torchaudio


EMOTION_LABELS = ["angry", "happy", "neutral", "sad"]
GENDER_LABELS = ["male", "female"]
IDX_TO_EMOTION = {index: label for index, label in enumerate(EMOTION_LABELS)}
IDX_TO_GENDER = {index: label for index, label in enumerate(GENDER_LABELS)}

DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "best_fold_Ses01.pt"
KAGGLE_CHECKPOINT_PATH = "/kaggle/working/models/best_fold_Ses01.pt"


class TSERAInferenceError(RuntimeError):
    """Base error for local TSERA inference failures."""


class CheckpointError(TSERAInferenceError):
    """Raised when a checkpoint is missing or incompatible."""


class AudioDecodeError(TSERAInferenceError):
    """Raised when an uploaded audio file cannot be decoded."""


@dataclass(frozen=True)
class InferenceConfig:
    sample_rate: int = 16_000
    clip_seconds: float = 5.0
    n_mels: int = 128
    n_fft: int = 1024
    win_length: int = 1024
    hop_length: int = 256
    target_frames: int = 313

    @property
    def target_samples(self) -> int:
        return int(self.sample_rate * self.clip_seconds)

    @property
    def feature_shape(self) -> tuple[int, int, int]:
        return (3, self.n_mels, self.target_frames)


DEFAULT_CONFIG = InferenceConfig()


@dataclass(frozen=True)
class AudioMetadata:
    filename: str
    sample_rate: int
    channels: int
    samples: int
    duration_seconds: float
    waveform_shape: tuple[int, ...]
    decoder: str


@dataclass(frozen=True)
class PreprocessingInfo:
    mono_shape: tuple[int, ...]
    resampled_shape: tuple[int, ...]
    source_sample_rate: int
    target_sample_rate: int
    action: str
    valid_samples: int
    fixed_samples: int
    fixed_duration_seconds: float
    valid_frames: int
    target_frames: int


@dataclass(frozen=True)
class ModelInternals:
    model_input_shape: tuple[int, ...]
    cnn_sequence_shape: tuple[int, ...]
    valid_cnn_steps: int
    total_cnn_steps: int
    attention_shape: tuple[int, ...]
    valid_attention_sum: float
    emotion_logits_shape: tuple[int, ...]
    gender_logits_shape: tuple[int, ...]


@dataclass(frozen=True)
class PredictionResult:
    audio: AudioMetadata
    preprocessing: PreprocessingInfo
    mono_waveform: torch.Tensor
    resampled_waveform: torch.Tensor
    fixed_waveform: torch.Tensor
    frame_mask: torch.Tensor
    log_mel: torch.Tensor
    delta: torch.Tensor
    delta_delta: torch.Tensor
    features: torch.Tensor
    normalized_features: torch.Tensor
    sequence_mask: torch.Tensor
    attention: torch.Tensor
    internals: ModelInternals
    emotion_probabilities: dict[str, float]
    gender_probabilities: dict[str, float]
    predicted_emotion: str
    predicted_gender: str
    emotion_confidence: float
    gender_confidence: float


@dataclass(frozen=True)
class LoadedModel:
    model: "TSERAModel"
    normalizer: "ChannelNormalizer"
    checkpoint: dict[str, Any]
    checkpoint_path: Path
    device: torch.device


def _load_with_torchaudio(path: Path) -> tuple[torch.Tensor, int, str]:
    waveform, sample_rate = torchaudio.load(str(path))
    return waveform, int(sample_rate), "torchaudio"


def _load_with_librosa(path: Path) -> tuple[torch.Tensor, int, str]:
    try:
        import librosa
        import numpy as np
    except Exception as exc:  # pragma: no cover - depends on local package state
        raise AudioDecodeError(
            "Audio decoding failed with torchaudio, and librosa is not available as a fallback."
        ) from exc

    try:
        samples, sample_rate = librosa.load(str(path), sr=None, mono=False)
    except Exception as exc:
        raise AudioDecodeError(f"Could not decode audio file: {path.name}") from exc

    array = np.asarray(samples, dtype="float32")
    if array.ndim == 1:
        array = array[None, :]
    return torch.as_tensor(array, dtype=torch.float32), int(sample_rate), "librosa"


def load_audio_file(path: Path, filename: str | None = None) -> tuple[torch.Tensor, AudioMetadata]:
    try:
        waveform, sample_rate, decoder = _load_with_torchaudio(path)
    except Exception:
        waveform, sample_rate, decoder = _load_with_librosa(path)

    if waveform.ndim == 1:
        waveform = waveform.unsqueeze(0)
    if waveform.ndim != 2:
        raise AudioDecodeError(f"Expected 1-D or 2-D audio, got shape {tuple(waveform.shape)}.")
    if sample_rate <= 0:
        raise AudioDecodeError(f"Invalid sample rate: {sample_rate}.")
    if waveform.shape[-1] == 0:
        raise AudioDecodeError("Audio file contains no samples.")

    waveform = waveform.to(torch.float32)
    samples = int(waveform.shape[-1])
    metadata = AudioMetadata(
        filename=filename or path.name,
        sample_rate=sample_rate,
        channels=int(waveform.shape[0]),
        samples=samples,
        duration_seconds=samples / sample_rate,
        waveform_shape=tuple(waveform.shape),
        decoder=decoder,
    )
    return waveform, metadata


def to_mono(waveform: torch.Tensor) -> torch.Tensor:
    if waveform.ndim == 1:
        return waveform.to(torch.float32)
    return waveform.mean(dim=0).to(torch.float32)


def resample_mono(waveform: torch.Tensor, source_rate: int, config: InferenceConfig = DEFAULT_CONFIG) -> torch.Tensor:
    if source_rate == config.sample_rate:
        return waveform.to(torch.float32)
    return torchaudio.functional.resample(
        waveform.to(torch.float32),
        orig_freq=source_rate,
        new_freq=config.sample_rate,
    )


def pad_or_trim_with_mask(
    waveform: torch.Tensor,
    config: InferenceConfig = DEFAULT_CONFIG,
) -> tuple[torch.Tensor, torch.Tensor, str, int]:
    valid_samples = min(int(waveform.numel()), config.target_samples)
    if waveform.numel() > config.target_samples:
        processed = waveform[: config.target_samples]
        action = "trimmed"
    elif waveform.numel() < config.target_samples:
        processed = torch.nn.functional.pad(waveform, (0, config.target_samples - waveform.numel()))
        action = "padded"
    else:
        processed = waveform
        action = "unchanged"

    valid_frames = min(config.target_frames, math.ceil(valid_samples / config.hop_length))
    frame_mask = torch.arange(config.target_frames) < valid_frames
    return processed.to(torch.float32), frame_mask, action, valid_samples


def make_mel_transform(config: InferenceConfig = DEFAULT_CONFIG) -> torchaudio.transforms.MelSpectrogram:
    return torchaudio.transforms.MelSpectrogram(
        sample_rate=config.sample_rate,
        n_fft=config.n_fft,
        win_length=config.win_length,
        hop_length=config.hop_length,
        n_mels=config.n_mels,
        power=2.0,
    )


def make_db_transform() -> torchaudio.transforms.AmplitudeToDB:
    return torchaudio.transforms.AmplitudeToDB(stype="power", top_db=80.0)


def fix_time_frames(tensor: torch.Tensor, config: InferenceConfig = DEFAULT_CONFIG) -> torch.Tensor:
    if tensor.shape[-1] > config.target_frames:
        return tensor[..., : config.target_frames]
    if tensor.shape[-1] < config.target_frames:
        return torch.nn.functional.pad(tensor, (0, config.target_frames - tensor.shape[-1]))
    return tensor


def extract_feature_channels(
    fixed_waveform: torch.Tensor,
    config: InferenceConfig = DEFAULT_CONFIG,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    mel_transform = make_mel_transform(config)
    db_transform = make_db_transform()
    log_mel = db_transform(mel_transform(fixed_waveform))
    delta = torchaudio.functional.compute_deltas(log_mel)
    delta_delta = torchaudio.functional.compute_deltas(delta)
    features = fix_time_frames(torch.stack([log_mel, delta, delta_delta]), config).to(torch.float32)
    if tuple(features.shape) != config.feature_shape:
        raise TSERAInferenceError(
            f"Expected feature shape {config.feature_shape}, got {tuple(features.shape)}."
        )
    return features, features[0].clone(), features[1].clone(), features[2].clone()


class ChannelNormalizer:
    def __init__(self, mean: torch.Tensor | None = None, std: torch.Tensor | None = None) -> None:
        self.mean = mean
        self.std = std

    def transform(self, features: torch.Tensor) -> torch.Tensor:
        if self.mean is None or self.std is None:
            raise CheckpointError("Checkpoint did not provide normalizer statistics.")
        mean = self.mean.to(device=features.device, dtype=features.dtype)
        std = self.std.to(device=features.device, dtype=features.dtype).clamp_min(1e-6)
        return (features - mean) / std


CNN_CHANNELS = [64, 128, 256]
TIME_KERNEL = (1, 11)
FREQUENCY_KERNEL = (11, 1)


def cnn_branch(kernel: tuple[int, int]) -> nn.Sequential:
    layers: list[nn.Module] = []
    input_channels = 3
    for output_channels in CNN_CHANNELS:
        layers.extend(
            [
                nn.Conv2d(input_channels, output_channels, kernel, padding="same"),
                nn.BatchNorm2d(output_channels),
                nn.ReLU(inplace=True),
                nn.MaxPool2d((2, 2)),
            ]
        )
        input_channels = output_channels
    return nn.Sequential(*layers)


class DualPathCNN(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.time_branch = cnn_branch(TIME_KERNEL)
        self.frequency_branch = cnn_branch(FREQUENCY_KERNEL)

    def forward(self, features: torch.Tensor) -> torch.Tensor:
        time_features = self.time_branch(features).mean(dim=2).permute(0, 2, 1)
        frequency_features = self.frequency_branch(features).mean(dim=2).permute(0, 2, 1)
        return torch.cat([time_features, frequency_features], dim=-1)


class MaskedAdditiveAttention(nn.Module):
    def __init__(self, hidden_size: int = 256, attention_size: int = 64) -> None:
        super().__init__()
        self.projection = nn.Linear(hidden_size, attention_size)
        self.score = nn.Linear(attention_size, 1, bias=False)

    def forward(self, sequence: torch.Tensor, mask: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        scores = self.score(torch.tanh(self.projection(sequence))).squeeze(-1)
        scores = scores.masked_fill(~mask, torch.finfo(scores.dtype).min)
        weights = torch.softmax(scores, dim=1)
        context = torch.sum(sequence * weights.unsqueeze(-1), dim=1)
        return context, weights.unsqueeze(-1)


class ABLSTM(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.lstm = nn.LSTM(
            input_size=512,
            hidden_size=128,
            num_layers=2,
            dropout=0.3,
            bidirectional=True,
            batch_first=True,
        )
        self.attention = MaskedAdditiveAttention()

    def forward(self, sequence: torch.Tensor, mask: torch.Tensor, return_attention: bool = False):
        encoded, _ = self.lstm(sequence)
        context, weights = self.attention(encoded, mask)
        return (context, weights) if return_attention else context


class MultiTaskHead(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.emotion = nn.Sequential(
            nn.Linear(256, 128),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(128, len(EMOTION_LABELS)),
        )
        self.gender = nn.Sequential(
            nn.Linear(256, 64),
            nn.ReLU(inplace=True),
            nn.Dropout(0.3),
            nn.Linear(64, len(GENDER_LABELS)),
        )

    def forward(self, embedding: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        return self.emotion(embedding), self.gender(embedding)


class TSERAModel(nn.Module):
    def __init__(self) -> None:
        super().__init__()
        self.dual_path_cnn = DualPathCNN()
        self.ablstm = ABLSTM()
        self.multi_task_head = MultiTaskHead()

    @staticmethod
    def downsample_mask(mask: torch.Tensor, output_steps: int) -> torch.Tensor:
        lengths = mask.sum(dim=1)
        downsampled_lengths = torch.div(lengths, 8, rounding_mode="floor").clamp(
            min=1,
            max=output_steps,
        )
        return torch.arange(output_steps, device=mask.device).unsqueeze(0) < downsampled_lengths.unsqueeze(1)

    def forward(self, features: torch.Tensor, frame_mask: torch.Tensor, return_attention: bool = False):
        sequence = self.dual_path_cnn(features)
        sequence_mask = self.downsample_mask(frame_mask, sequence.shape[1])
        if return_attention:
            embedding, attention = self.ablstm(sequence, sequence_mask, return_attention=True)
            emotion, gender = self.multi_task_head(embedding)
            return emotion, gender, attention, sequence_mask
        embedding = self.ablstm(sequence, sequence_mask)
        return self.multi_task_head(embedding)


def _torch_load_checkpoint(path: Path, device: torch.device) -> dict[str, Any]:
    try:
        return torch.load(path, map_location=device, weights_only=True)
    except TypeError:  # pragma: no cover - compatibility with older torch
        return torch.load(path, map_location=device)


def load_checkpoint(
    checkpoint_path: Path = DEFAULT_MODEL_PATH,
    device: str | torch.device = "cpu",
) -> LoadedModel:
    path = Path(checkpoint_path)
    if not path.exists():
        raise CheckpointError(
            f"Missing checkpoint at {path}. Download {KAGGLE_CHECKPOINT_PATH} from Kaggle "
            f"and place it at {DEFAULT_MODEL_PATH}."
        )

    torch_device = torch.device(device)
    checkpoint = _torch_load_checkpoint(path, torch_device)
    missing = {"model_state_dict", "normalizer_mean", "normalizer_std"} - set(checkpoint)
    if missing:
        raise CheckpointError(f"Checkpoint is missing required keys: {sorted(missing)}.")

    model = TSERAModel().to(torch_device)
    state = {
        key.removeprefix("module."): value
        for key, value in checkpoint["model_state_dict"].items()
    }
    model.load_state_dict(state)
    model.eval()

    normalizer = ChannelNormalizer(
        mean=checkpoint["normalizer_mean"].detach().cpu(),
        std=checkpoint["normalizer_std"].detach().cpu(),
    )
    return LoadedModel(
        model=model,
        normalizer=normalizer,
        checkpoint=checkpoint,
        checkpoint_path=path,
        device=torch_device,
    )


def probability_dict(probabilities: torch.Tensor, labels: list[str]) -> dict[str, float]:
    return {
        label: float(probabilities[index].detach().cpu())
        for index, label in enumerate(labels)
    }


@torch.no_grad()
def predict_audio_file(
    audio_path: Path,
    loaded: LoadedModel | None = None,
    config: InferenceConfig = DEFAULT_CONFIG,
    filename: str | None = None,
) -> PredictionResult:
    loaded_model = loaded or load_checkpoint(DEFAULT_MODEL_PATH, device="cpu")
    waveform, metadata = load_audio_file(Path(audio_path), filename=filename)

    mono = to_mono(waveform)
    resampled = resample_mono(mono, metadata.sample_rate, config)
    fixed, frame_mask, action, valid_samples = pad_or_trim_with_mask(resampled, config)
    features, log_mel, delta, delta_delta = extract_feature_channels(fixed, config)
    normalized = loaded_model.normalizer.transform(features)

    model_input = normalized.unsqueeze(0).to(loaded_model.device)
    model_mask = frame_mask.unsqueeze(0).to(loaded_model.device)

    cnn_output = loaded_model.model.dual_path_cnn(model_input)
    sequence_mask = loaded_model.model.downsample_mask(model_mask, cnn_output.shape[1])
    embedding, attention = loaded_model.model.ablstm(cnn_output, sequence_mask, return_attention=True)
    emotion_logits, gender_logits = loaded_model.model.multi_task_head(embedding)

    emotion_probs = torch.softmax(emotion_logits, dim=1).squeeze(0).cpu()
    gender_probs = torch.softmax(gender_logits, dim=1).squeeze(0).cpu()
    emotion_index = int(emotion_probs.argmax())
    gender_index = int(gender_probs.argmax())

    attention_cpu = attention.squeeze(0).squeeze(-1).cpu()
    sequence_mask_cpu = sequence_mask.squeeze(0).cpu()
    valid_attention_sum = float(attention_cpu[sequence_mask_cpu].sum())

    preprocessing = PreprocessingInfo(
        mono_shape=tuple(mono.shape),
        resampled_shape=tuple(resampled.shape),
        source_sample_rate=metadata.sample_rate,
        target_sample_rate=config.sample_rate,
        action=action,
        valid_samples=valid_samples,
        fixed_samples=int(fixed.numel()),
        fixed_duration_seconds=fixed.numel() / config.sample_rate,
        valid_frames=int(frame_mask.sum()),
        target_frames=config.target_frames,
    )
    internals = ModelInternals(
        model_input_shape=tuple(model_input.shape),
        cnn_sequence_shape=tuple(cnn_output.shape),
        valid_cnn_steps=int(sequence_mask_cpu.sum()),
        total_cnn_steps=int(sequence_mask_cpu.numel()),
        attention_shape=tuple(attention.shape),
        valid_attention_sum=valid_attention_sum,
        emotion_logits_shape=tuple(emotion_logits.shape),
        gender_logits_shape=tuple(gender_logits.shape),
    )

    return PredictionResult(
        audio=metadata,
        preprocessing=preprocessing,
        mono_waveform=mono.detach().cpu(),
        resampled_waveform=resampled.detach().cpu(),
        fixed_waveform=fixed.detach().cpu(),
        frame_mask=frame_mask.detach().cpu(),
        log_mel=log_mel.detach().cpu(),
        delta=delta.detach().cpu(),
        delta_delta=delta_delta.detach().cpu(),
        features=features.detach().cpu(),
        normalized_features=normalized.detach().cpu(),
        sequence_mask=sequence_mask_cpu,
        attention=attention_cpu,
        internals=internals,
        emotion_probabilities=probability_dict(emotion_probs, EMOTION_LABELS),
        gender_probabilities=probability_dict(gender_probs, GENDER_LABELS),
        predicted_emotion=IDX_TO_EMOTION[emotion_index],
        predicted_gender=IDX_TO_GENDER[gender_index],
        emotion_confidence=float(emotion_probs[emotion_index]),
        gender_confidence=float(gender_probs[gender_index]),
    )
