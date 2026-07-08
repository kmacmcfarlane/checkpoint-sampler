package store

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"time"

	"github.com/kmacmcfarlane/checkpoint-sampler/backend/internal/model"
	"github.com/sirupsen/logrus"
)

// studyEntity is the persistence representation of a study.
type studyEntity struct {
	ID                    string
	Name                  string
	PromptPrefix          string
	Prompts               string // JSON
	NegativePrompt        string
	Steps                 string // JSON
	CFGs                  string // JSON
	SamplerSchedulerPairs string // JSON
	Seeds                 string // JSON
	Width                 int
	Height                int
	WorkflowTemplate      *string  // nullable
	VAE                   *string  // nullable
	TextEncoder           *string  // nullable
	Shift                 *float64 // nullable
	LoraStrengthPairs     string   // JSON
	Resolutions           string   // JSON (S-157)
	VAEs                  string   // JSON (S-157)
	TextEncoders          string   // JSON (S-157)
	Shifts                string   // JSON (S-157)
	CreatedAt             string   // RFC3339
	UpdatedAt             string   // RFC3339
}

// promptJSON is the JSON shape for named prompts.
type promptJSON struct {
	Name string `json:"name"`
	Text string `json:"text"`
}

// samplerSchedulerPairJSON is the JSON shape for sampler/scheduler pairs.
type samplerSchedulerPairJSON struct {
	Sampler   string `json:"sampler"`
	Scheduler string `json:"scheduler"`
}

// loraStrengthPairJSON is the JSON shape for LoRA strength pairs.
type loraStrengthPairJSON struct {
	StrengthModel float64 `json:"strength_model"`
	StrengthClip  float64 `json:"strength_clip"`
}

// resolutionPairJSON is the JSON shape for resolution pairs (S-157).
type resolutionPairJSON struct {
	Width  int `json:"width"`
	Height int `json:"height"`
}

// ListStudies returns all studies ordered by name.
func (s *Store) ListStudies() ([]model.Study, error) {
	s.logger.Trace("entering ListStudies")
	defer s.logger.Trace("returning from ListStudies")

	rows, err := s.db.Query(`SELECT id, name, prompt_prefix, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs, seeds, width, height, workflow_template, vae, text_encoder, shift, lora_strength_pairs, resolutions, vaes, text_encoders, shifts, created_at, updated_at
		FROM studies ORDER BY name`)
	if err != nil {
		s.logger.WithError(err).Error("failed to query studies")
		return nil, fmt.Errorf("querying studies: %w", err)
	}
	defer rows.Close()

	var studies []model.Study
	for rows.Next() {
		var e studyEntity
		if err := rows.Scan(&e.ID, &e.Name, &e.PromptPrefix, &e.Prompts, &e.NegativePrompt, &e.Steps, &e.CFGs, &e.SamplerSchedulerPairs, &e.Seeds, &e.Width, &e.Height, &e.WorkflowTemplate, &e.VAE, &e.TextEncoder, &e.Shift, &e.LoraStrengthPairs, &e.Resolutions, &e.VAEs, &e.TextEncoders, &e.Shifts, &e.CreatedAt, &e.UpdatedAt); err != nil {
			s.logger.WithError(err).Error("failed to scan study row")
			return nil, fmt.Errorf("scanning study row: %w", err)
		}
		st, err := studyEntityToModel(e)
		if err != nil {
			s.logger.WithError(err).Error("failed to convert entity to model")
			return nil, err
		}
		studies = append(studies, st)
	}
	if err := rows.Err(); err != nil {
		s.logger.WithError(err).Error("error iterating studies")
		return nil, fmt.Errorf("iterating studies: %w", err)
	}
	s.logger.WithField("study_count", len(studies)).Debug("listed studies from database")
	return studies, nil
}

// GetStudy returns a single study by ID, or sql.ErrNoRows if not found.
func (s *Store) GetStudy(id string) (model.Study, error) {
	s.logger.WithField("study_id", id).Trace("entering GetStudy")
	defer s.logger.Trace("returning from GetStudy")

	var e studyEntity
	err := s.db.QueryRow(
		`SELECT id, name, prompt_prefix, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs, seeds, width, height, workflow_template, vae, text_encoder, shift, lora_strength_pairs, resolutions, vaes, text_encoders, shifts, created_at, updated_at
		FROM studies WHERE id = ?`, id,
	).Scan(&e.ID, &e.Name, &e.PromptPrefix, &e.Prompts, &e.NegativePrompt, &e.Steps, &e.CFGs, &e.SamplerSchedulerPairs, &e.Seeds, &e.Width, &e.Height, &e.WorkflowTemplate, &e.VAE, &e.TextEncoder, &e.Shift, &e.LoraStrengthPairs, &e.Resolutions, &e.VAEs, &e.TextEncoders, &e.Shifts, &e.CreatedAt, &e.UpdatedAt)
	if err != nil {
		if err == sql.ErrNoRows {
			s.logger.WithField("study_id", id).Debug("study not found in database")
		} else {
			s.logger.WithFields(logrus.Fields{
				"study_id": id,
				"error":    err.Error(),
			}).Error("failed to query study")
		}
		return model.Study{}, err
	}
	s.logger.WithField("study_id", id).Debug("fetched study from database")
	return studyEntityToModel(e)
}

// CreateStudy inserts a new study.
func (s *Store) CreateStudy(st model.Study) error {
	s.logger.WithFields(logrus.Fields{
		"study_id":   st.ID,
		"study_name": st.Name,
	}).Trace("entering CreateStudy")
	defer s.logger.Trace("returning from CreateStudy")

	entity, err := studyModelToEntity(st)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id": st.ID,
			"error":    err.Error(),
		}).Error("failed to convert model to entity")
		return err
	}

	_, err = s.db.Exec(
		`INSERT INTO studies (id, name, prompt_prefix, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs, seeds, width, height, workflow_template, vae, text_encoder, shift, lora_strength_pairs, resolutions, vaes, text_encoders, shifts, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		entity.ID,
		entity.Name,
		entity.PromptPrefix,
		entity.Prompts,
		entity.NegativePrompt,
		entity.Steps,
		entity.CFGs,
		entity.SamplerSchedulerPairs,
		entity.Seeds,
		entity.Width,
		entity.Height,
		entity.WorkflowTemplate,
		entity.VAE,
		entity.TextEncoder,
		entity.Shift,
		entity.LoraStrengthPairs,
		entity.Resolutions,
		entity.VAEs,
		entity.TextEncoders,
		entity.Shifts,
		entity.CreatedAt,
		entity.UpdatedAt,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id":   st.ID,
			"study_name": st.Name,
			"error":      err.Error(),
		}).Error("failed to insert study into database")
		return fmt.Errorf("inserting study: %w", err)
	}
	s.logger.WithFields(logrus.Fields{
		"study_id":   st.ID,
		"study_name": st.Name,
	}).Info("inserted study into database")
	return nil
}

// UpdateStudy updates an existing study. Returns
// sql.ErrNoRows if the study does not exist.
func (s *Store) UpdateStudy(st model.Study) error {
	s.logger.WithFields(logrus.Fields{
		"study_id":   st.ID,
		"study_name": st.Name,
	}).Trace("entering UpdateStudy")
	defer s.logger.Trace("returning from UpdateStudy")

	entity, err := studyModelToEntity(st)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id": st.ID,
			"error":    err.Error(),
		}).Error("failed to convert model to entity")
		return err
	}

	result, err := s.db.Exec(
		`UPDATE studies SET name = ?, prompt_prefix = ?, prompts = ?, negative_prompt = ?, steps = ?, cfgs = ?, sampler_scheduler_pairs = ?, seeds = ?, width = ?, height = ?, workflow_template = ?, vae = ?, text_encoder = ?, shift = ?, lora_strength_pairs = ?, resolutions = ?, vaes = ?, text_encoders = ?, shifts = ?, updated_at = ?
		WHERE id = ?`,
		entity.Name,
		entity.PromptPrefix,
		entity.Prompts,
		entity.NegativePrompt,
		entity.Steps,
		entity.CFGs,
		entity.SamplerSchedulerPairs,
		entity.Seeds,
		entity.Width,
		entity.Height,
		entity.WorkflowTemplate,
		entity.VAE,
		entity.TextEncoder,
		entity.Shift,
		entity.LoraStrengthPairs,
		entity.Resolutions,
		entity.VAEs,
		entity.TextEncoders,
		entity.Shifts,
		entity.UpdatedAt,
		entity.ID,
	)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id":   st.ID,
			"study_name": st.Name,
			"error":      err.Error(),
		}).Error("failed to update study in database")
		return fmt.Errorf("updating study: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id": st.ID,
			"error":    err.Error(),
		}).Error("failed to check rows affected")
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("study_id", st.ID).Debug("no rows affected, study not found")
		return sql.ErrNoRows
	}
	s.logger.WithFields(logrus.Fields{
		"study_id":   st.ID,
		"study_name": st.Name,
	}).Info("updated study in database")
	return nil
}

// GetStudyByName returns the first study with the given name, excluding the
// study with excludeID (pass "" to include all studies). Returns sql.ErrNoRows
// if no matching study is found.
func (s *Store) GetStudyByName(name string, excludeID string) (model.Study, error) {
	s.logger.WithField("study_name", name).Trace("entering GetStudyByName")
	defer s.logger.Trace("returning from GetStudyByName")

	var e studyEntity
	var err error
	if excludeID == "" {
		err = s.db.QueryRow(
			`SELECT id, name, prompt_prefix, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs, seeds, width, height, workflow_template, vae, text_encoder, shift, lora_strength_pairs, resolutions, vaes, text_encoders, shifts, created_at, updated_at
			FROM studies WHERE name = ? LIMIT 1`, name,
		).Scan(&e.ID, &e.Name, &e.PromptPrefix, &e.Prompts, &e.NegativePrompt, &e.Steps, &e.CFGs, &e.SamplerSchedulerPairs, &e.Seeds, &e.Width, &e.Height, &e.WorkflowTemplate, &e.VAE, &e.TextEncoder, &e.Shift, &e.LoraStrengthPairs, &e.Resolutions, &e.VAEs, &e.TextEncoders, &e.Shifts, &e.CreatedAt, &e.UpdatedAt)
	} else {
		err = s.db.QueryRow(
			`SELECT id, name, prompt_prefix, prompts, negative_prompt, steps, cfgs, sampler_scheduler_pairs, seeds, width, height, workflow_template, vae, text_encoder, shift, lora_strength_pairs, resolutions, vaes, text_encoders, shifts, created_at, updated_at
			FROM studies WHERE name = ? AND id != ? LIMIT 1`, name, excludeID,
		).Scan(&e.ID, &e.Name, &e.PromptPrefix, &e.Prompts, &e.NegativePrompt, &e.Steps, &e.CFGs, &e.SamplerSchedulerPairs, &e.Seeds, &e.Width, &e.Height, &e.WorkflowTemplate, &e.VAE, &e.TextEncoder, &e.Shift, &e.LoraStrengthPairs, &e.Resolutions, &e.VAEs, &e.TextEncoders, &e.Shifts, &e.CreatedAt, &e.UpdatedAt)
	}
	if err != nil {
		if err == sql.ErrNoRows {
			s.logger.WithField("study_name", name).Debug("no study found with name")
		} else {
			s.logger.WithFields(logrus.Fields{
				"study_name": name,
				"error":      err.Error(),
			}).Error("failed to query study by name")
		}
		return model.Study{}, err
	}
	s.logger.WithField("study_name", name).Debug("fetched study by name from database")
	return studyEntityToModel(e)
}

// DeleteStudy removes a study by ID. Returns sql.ErrNoRows if the study
// does not exist.
func (s *Store) DeleteStudy(id string) error {
	s.logger.WithField("study_id", id).Trace("entering DeleteStudy")
	defer s.logger.Trace("returning from DeleteStudy")

	result, err := s.db.Exec("DELETE FROM studies WHERE id = ?", id)
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id": id,
			"error":    err.Error(),
		}).Error("failed to delete study from database")
		return fmt.Errorf("deleting study: %w", err)
	}
	rows, err := result.RowsAffected()
	if err != nil {
		s.logger.WithFields(logrus.Fields{
			"study_id": id,
			"error":    err.Error(),
		}).Error("failed to check rows affected")
		return fmt.Errorf("checking rows affected: %w", err)
	}
	if rows == 0 {
		s.logger.WithField("study_id", id).Debug("no rows affected, study not found")
		return sql.ErrNoRows
	}
	s.logger.WithField("study_id", id).Info("deleted study from database")
	return nil
}

func studyEntityToModel(e studyEntity) (model.Study, error) {
	var prompts []promptJSON
	if err := json.Unmarshal([]byte(e.Prompts), &prompts); err != nil {
		return model.Study{}, fmt.Errorf("unmarshaling prompts: %w", err)
	}

	var steps []int
	if err := json.Unmarshal([]byte(e.Steps), &steps); err != nil {
		return model.Study{}, fmt.Errorf("unmarshaling steps: %w", err)
	}

	var cfgs []float64
	if err := json.Unmarshal([]byte(e.CFGs), &cfgs); err != nil {
		return model.Study{}, fmt.Errorf("unmarshaling cfgs: %w", err)
	}

	var pairsJSON []samplerSchedulerPairJSON
	if err := json.Unmarshal([]byte(e.SamplerSchedulerPairs), &pairsJSON); err != nil {
		return model.Study{}, fmt.Errorf("unmarshaling sampler_scheduler_pairs: %w", err)
	}

	var seeds []int64
	if err := json.Unmarshal([]byte(e.Seeds), &seeds); err != nil {
		return model.Study{}, fmt.Errorf("unmarshaling seeds: %w", err)
	}

	var loraPairsJSON []loraStrengthPairJSON
	if err := json.Unmarshal([]byte(e.LoraStrengthPairs), &loraPairsJSON); err != nil {
		return model.Study{}, fmt.Errorf("unmarshaling lora_strength_pairs: %w", err)
	}

	// S-157 multi-value dimensions. Older rows (pre-migration-28) or test fixtures
	// may have empty column strings; treat those as empty lists.
	var resolutionsJSON []resolutionPairJSON
	if e.Resolutions != "" {
		if err := json.Unmarshal([]byte(e.Resolutions), &resolutionsJSON); err != nil {
			return model.Study{}, fmt.Errorf("unmarshaling resolutions: %w", err)
		}
	}
	var vaes []string
	if e.VAEs != "" {
		if err := json.Unmarshal([]byte(e.VAEs), &vaes); err != nil {
			return model.Study{}, fmt.Errorf("unmarshaling vaes: %w", err)
		}
	}
	var textEncoders []string
	if e.TextEncoders != "" {
		if err := json.Unmarshal([]byte(e.TextEncoders), &textEncoders); err != nil {
			return model.Study{}, fmt.Errorf("unmarshaling text_encoders: %w", err)
		}
	}
	var shifts []float64
	if e.Shifts != "" {
		if err := json.Unmarshal([]byte(e.Shifts), &shifts); err != nil {
			return model.Study{}, fmt.Errorf("unmarshaling shifts: %w", err)
		}
	}

	createdAt, err := time.Parse(time.RFC3339, e.CreatedAt)
	if err != nil {
		return model.Study{}, fmt.Errorf("parsing created_at: %w", err)
	}
	updatedAt, err := time.Parse(time.RFC3339, e.UpdatedAt)
	if err != nil {
		return model.Study{}, fmt.Errorf("parsing updated_at: %w", err)
	}

	namedPrompts := make([]model.NamedPrompt, len(prompts))
	for i, p := range prompts {
		namedPrompts[i] = model.NamedPrompt{
			Name: p.Name,
			Text: p.Text,
		}
	}

	pairs := make([]model.SamplerSchedulerPair, len(pairsJSON))
	for i, p := range pairsJSON {
		pairs[i] = model.SamplerSchedulerPair{
			Sampler:   p.Sampler,
			Scheduler: p.Scheduler,
		}
	}

	loraPairs := make([]model.LoraStrengthPair, len(loraPairsJSON))
	for i, lp := range loraPairsJSON {
		loraPairs[i] = model.LoraStrengthPair{
			StrengthModel: lp.StrengthModel,
			StrengthClip:  lp.StrengthClip,
		}
	}

	resolutions := make([]model.ResolutionPair, len(resolutionsJSON))
	for i, rp := range resolutionsJSON {
		resolutions[i] = model.ResolutionPair{Width: rp.Width, Height: rp.Height}
	}

	// Convert nullable pointer fields to their zero-value equivalents for the model.
	workflowTemplate := ""
	if e.WorkflowTemplate != nil {
		workflowTemplate = *e.WorkflowTemplate
	}
	vae := ""
	if e.VAE != nil {
		vae = *e.VAE
	}
	textEncoder := ""
	if e.TextEncoder != nil {
		textEncoder = *e.TextEncoder
	}

	return model.Study{
		ID:                    e.ID,
		Name:                  e.Name,
		PromptPrefix:          e.PromptPrefix,
		Prompts:               namedPrompts,
		NegativePrompt:        e.NegativePrompt,
		Steps:                 steps,
		CFGs:                  cfgs,
		SamplerSchedulerPairs: pairs,
		Seeds:                 seeds,
		Width:                 e.Width,
		Height:                e.Height,
		WorkflowTemplate:      workflowTemplate,
		VAE:                   vae,
		TextEncoder:           textEncoder,
		Shift:                 e.Shift,
		Resolutions:           resolutions,
		VAEs:                  vaes,
		TextEncoders:          textEncoders,
		Shifts:                shifts,
		LoraStrengthPairs:     loraPairs,
		CreatedAt:             createdAt,
		UpdatedAt:             updatedAt,
	}, nil
}

func studyModelToEntity(st model.Study) (studyEntity, error) {
	prompts := make([]promptJSON, len(st.Prompts))
	for i, np := range st.Prompts {
		prompts[i] = promptJSON{
			Name: np.Name,
			Text: np.Text,
		}
	}

	promptsBytes, err := json.Marshal(prompts)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling prompts: %w", err)
	}

	stepsBytes, err := json.Marshal(st.Steps)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling steps: %w", err)
	}

	cfgsBytes, err := json.Marshal(st.CFGs)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling cfgs: %w", err)
	}

	pairsJSON := make([]samplerSchedulerPairJSON, len(st.SamplerSchedulerPairs))
	for i, pair := range st.SamplerSchedulerPairs {
		pairsJSON[i] = samplerSchedulerPairJSON{
			Sampler:   pair.Sampler,
			Scheduler: pair.Scheduler,
		}
	}
	pairsBytes, err := json.Marshal(pairsJSON)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling sampler_scheduler_pairs: %w", err)
	}

	seedsBytes, err := json.Marshal(st.Seeds)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling seeds: %w", err)
	}

	loraPairsJSON := make([]loraStrengthPairJSON, len(st.LoraStrengthPairs))
	for i, lp := range st.LoraStrengthPairs {
		loraPairsJSON[i] = loraStrengthPairJSON{
			StrengthModel: lp.StrengthModel,
			StrengthClip:  lp.StrengthClip,
		}
	}
	loraPairsBytes, err := json.Marshal(loraPairsJSON)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling lora_strength_pairs: %w", err)
	}

	// S-157: marshal multi-value dimensions. Empty/nil lists serialize to "[]".
	resolutionsJSON := make([]resolutionPairJSON, len(st.Resolutions))
	for i, rp := range st.Resolutions {
		resolutionsJSON[i] = resolutionPairJSON{Width: rp.Width, Height: rp.Height}
	}
	resolutionsBytes, err := json.Marshal(resolutionsJSON)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling resolutions: %w", err)
	}
	vaesList := st.VAEs
	if vaesList == nil {
		vaesList = []string{}
	}
	vaesBytes, err := json.Marshal(vaesList)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling vaes: %w", err)
	}
	textEncodersList := st.TextEncoders
	if textEncodersList == nil {
		textEncodersList = []string{}
	}
	textEncodersBytes, err := json.Marshal(textEncodersList)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling text_encoders: %w", err)
	}
	shiftsList := st.Shifts
	if shiftsList == nil {
		shiftsList = []float64{}
	}
	shiftsBytes, err := json.Marshal(shiftsList)
	if err != nil {
		return studyEntity{}, fmt.Errorf("marshaling shifts: %w", err)
	}

	// Convert empty string fields to nil pointers so they are stored as NULL.
	var workflowTemplate *string
	if st.WorkflowTemplate != "" {
		workflowTemplate = &st.WorkflowTemplate
	}
	var vae *string
	if st.VAE != "" {
		vae = &st.VAE
	}
	var textEncoder *string
	if st.TextEncoder != "" {
		textEncoder = &st.TextEncoder
	}

	return studyEntity{
		ID:                    st.ID,
		Name:                  st.Name,
		PromptPrefix:          st.PromptPrefix,
		Prompts:               string(promptsBytes),
		NegativePrompt:        st.NegativePrompt,
		Steps:                 string(stepsBytes),
		CFGs:                  string(cfgsBytes),
		SamplerSchedulerPairs: string(pairsBytes),
		Seeds:                 string(seedsBytes),
		Width:                 st.Width,
		Height:                st.Height,
		WorkflowTemplate:      workflowTemplate,
		VAE:                   vae,
		TextEncoder:           textEncoder,
		Shift:                 st.Shift,
		LoraStrengthPairs:     string(loraPairsBytes),
		Resolutions:           string(resolutionsBytes),
		VAEs:                  string(vaesBytes),
		TextEncoders:          string(textEncodersBytes),
		Shifts:                string(shiftsBytes),
		CreatedAt:             st.CreatedAt.UTC().Format(time.RFC3339),
		UpdatedAt:             st.UpdatedAt.UTC().Format(time.RFC3339),
	}, nil
}
